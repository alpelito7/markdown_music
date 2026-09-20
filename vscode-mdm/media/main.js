// main.js: webview for the MDM editor. A CodeMirror 6 view over the Markdown
// text of the document (the text IS the file text, save for the YAML header
// while it is hidden), decorated Typora style: equations, scores, code, marks
// and fences render in place and show their source where a caret is. Every
// selection range counts, so each of several carets reveals what it edits.
// Kept in sync both ways with the VS Code TextDocument through the host.
//
// CodeMirror, KaTeX and the MDM Lezer extensions come from
// vendor/cm6/cm6.bundle.js (built by vendor-src/, exposed as window.CM); the
// scores are engraved and played by the abcjs in vendor/abcjs.
(function () {
  const vscode = acquireVsCodeApi();
  const CM = window.CM;

  let view = null; // the EditorView, once the first document arrives
  let applying = false; // applying an incoming update; do not send it back as an edit
  let pending = null; // debounce for outgoing edits
  let scrollToTop = false; // the next update goes to the top of the document
  const SETTINGS = window.MDM_SETTINGS || {};
  let themeSetting = SETTINGS.theme || "auto";
  let scoreFill = SETTINGS.scoreFill || "none";
  let staffLines = SETTINGS.staffLines || "gray";
  let scoreAlign = SETTINGS.scoreAlign || "center";
  let frontMatter = SETTINGS.frontMatter || "hidden";
  let hyphenation = SETTINGS.hyphenation || "none";
  // VS Code's own editor.multiCursorModifier ("alt" or "ctrlCmd"): the click
  // that adds a caret here is the one the user already makes in text editors.
  let multiCursorModifier = SETTINGS.multiCursorModifier || "alt";

  // The webview never writes a setting itself: it asks the host, which stores
  // it and echoes the stored value back as a "settings" message. That keeps
  // every open .mdm editor in step and makes a choice survive a reload. Word
  // division is the exception: the host keeps that one per document, so what
  // comes back for it is this document's own.
  function askSetting(key, value) {
    vscode.postMessage({ type: "setSetting", key: key, value: value });
  }

  function app() {
    return document.getElementById("app");
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

  function applyTheme() {
    const root = app();
    if (!root) return;
    root.classList.toggle("mdm--dark", isDark());
    // MDM Light, Dark and White (OWN_LOOKS, under Syntax colours) select in a
    // colour of their own, --mdm-selection in style.css, and not in the VS
    // Code theme's.
    root.classList.toggle("mdm-look--own", !!OWN_LOOKS[themeSetting]);
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
  //
  // And only while the look asked for is somebody else's. MDM Light, MDM Dark
  // and MDM White are this editor's own, which is what their names say and
  // what they are picked for: the palettes baked into style.css paint them,
  // whatever VS Code is wearing, so that picking one gets the same editor on
  // every machine. "Follow VS Code" and the named themes under it are the
  // entries that bring colours from outside.
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

  const OWN_LOOKS = { light: true, dark: true, white: true };

  function applyPalette() {
    const root = document.getElementById("app");
    if (!root) return;
    const usable =
      !OWN_LOOKS[themeSetting] &&
      palette &&
      palette.colors &&
      palette.kind === (isDark() ? "dark" : "light");
    SYNTAX_SLOTS.forEach(function (slot) {
      const value = usable ? palette.colors[slot] : null;
      if (value) root.style.setProperty("--mdm-syn-" + slot, value);
      else root.style.removeProperty("--mdm-syn-" + slot);
    });
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

  // MDM White is the light look on a sheet of paper: the page goes to white
  // instead of the wash the theme gives it, and the code keeps its slate (see
  // --mdm-syn-page in style.css). It sits with the sides rather than in a
  // switch of its own: what it changes is how the editor looks, which is what
  // this menu is for, and every other entry rules it out anyway, since a sheet
  // of paper under a dark theme would leave dark syntax colours on white.
  //
  // The three carry the extension's name because the entries under them are
  // the colour themes installed in VS Code, by their own names: "MDM Dark" is
  // this editor's dark, one of the list rather than a switch over it. The
  // values behind the labels are the old ones, so a settings file that says
  // `"mdm.theme": "dark"` still means what it meant.
  const THEME_SIDES = [
    { value: "auto", label: "Follow VS Code" },
    { value: "light", label: "MDM Light" },
    { value: "dark", label: "MDM Dark" },
    { value: "white", label: "MDM White" },
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
  // spaces and punctuation. Entries of the drop-down panel: see toolbarButton.
  function themeMenuItems() {
    return themeEntries().map(function (entry, i) {
      return {
        name: "mdm-theme-" + i,
        label: themeMenuLabel(entry),
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
  // tooltip names what the click switches to, not the state in use. The
  // lit state marks ink, not gray: the button stays quiet for as
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
    btn.classList.toggle("mdm-btn--on", staffLines === "ink");
  }

  // ---------- Following the playhead ----------

  // Whether the page keeps up with the playhead: on, it keeps the staff
  // system that is sounding whole on the pane (showPlayhead); off, the music
  // never moves the page at all, so a score longer than the pane can sound
  // while the document around it is read, which there was no way to ask for.
  // On by default, which is what the page has always done.
  //
  // The playhead and not "the music" is what the button says, because the
  // playhead is the thing that moves and the thing the page is chasing: a
  // tune can sound with the page perfectly still, and it is the mark walking
  // the staff that a reader is asking to keep in front of them.
  //
  // In the toolbar with the other things that are set once and left, and not
  // in the player row: it says what this editor does with a tune rather than
  // what this tune is doing, and it is worth setting before a player is open
  // at all. Lit while the page is NOT following, which is the convention of
  // the staff-line, multicursor and text-font toggles rather than the theme
  // button's (whose glyph names what the click leads to): the lamp marks the
  // setting that was asked for, and following is what the editor does before
  // anyone asks for anything.
  //
  // The page and the head that walks it: three rules of text with the
  // playhead standing across them, which is the one mark of this editor that
  // means "here is the music". Rects and no strokes, since the toolbar
  // stylesheet sets stroke-width 0; three rules and not four, so it is not
  // the staff icon two buttons along.
  const FOLLOW_ICON =
    '<svg viewBox="0 0 16 16">' +
    '<rect x="1.5" y="3" width="13" height="1.3" rx=".65"/>' +
    '<rect x="1.5" y="7.35" width="13" height="1.3" rx=".65"/>' +
    '<rect x="1.5" y="11.7" width="13" height="1.3" rx=".65"/>' +
    '<rect x="9.9" y="1.3" width="1.5" height="13.4" rx=".75"/>' +
    "</svg>";

  let following = SETTINGS.followPlayhead !== "still";

  // One verb and its negation, so the two states of the button read as one
  // switch. "Let the page be" said the same thing in better English and named
  // neither the playhead nor the following, so a reader meeting the off state
  // first had no way to tell what the button was for.
  function followTip() {
    return following ? "Unfollow the playhead" : "Follow the playhead";
  }

  // Lit while the page is NOT following, which is the convention of the rest
  // of the bar: the lamp marks the setting that was asked for, and following
  // is what the editor does before anyone asks for anything. The staff-line,
  // multicursor and text-font toggles all light this way round.
  function updateFollowButton() {
    const btn = document.querySelector('#app button[data-type="mdm-follow"]');
    if (!btn) return;
    btn.setAttribute("aria-label", followTip());
    btn.classList.toggle("mdm-btn--on", !following);
  }

  // The setting has come back from the host: the button follows it, and a tune
  // already sounding is brought under the pane at once. Turning it on is a
  // gesture asking to see the music, and a gesture is answered where it is
  // made rather than at whatever the tune does next.
  function applyFollowPlayhead() {
    updateFollowButton();
    if (following) revealPlayhead();
  }

  // ---------- The face of the text ----------

  // Which of the two faces the document is set in: Latin Modern Roman, the
  // one TeX sets a document in, carried inside the extension as four woff2
  // files, or the interface sans of the system, which is what the editor used
  // to be set in and what the rest of VS Code is set in. Roman by default: the
  // equations beside the words are already drawn in those shapes (KaTeX's
  // faces are Computer Modern, and Latin Modern is Computer Modern too), so
  // the sans was the odd one out on the page rather than the roman.
  //
  // Nothing is installed for it and no LaTeX is involved. The face travels
  // with the extension the way KaTeX's own faces do.
  //
  // Only the text moves. The toolbar, the menus and the outline panel take
  // their face off #app and stay in the sans; code, the numbers in the margin
  // and the source of an open block keep the monospace they always had. The
  // stylesheet holds the whole of it in --mdm-text (style.css).
  //
  // A serif A, which is the letter a type specimen shows and the one place
  // 15px is enough to tell the two faces apart: the feet and the flat top
  // serif are the whole signal at that size, the thin left stroke and the
  // thick right one being lost. Rects and polygons, no strokes, since the
  // toolbar stylesheet sets stroke-width 0.
  const TEXT_FONT_ICON =
    '<svg viewBox="0 0 16 16">' +
    '<polygon points="7.9,2.2 8.7,2.2 6.1,13 5.1,13"/>' +
    '<polygon points="8.0,2.2 8.9,2.2 11.3,13 9.6,13"/>' +
    '<rect x="6.05" y="9.15" width="4.2" height="1.05" rx=".5"/>' +
    '<rect x="7.3" y="1.6" width="2.1" height="1" rx=".5"/>' +
    '<rect x="3.5" y="12.8" width="4.1" height="1.3" rx=".55"/>' +
    '<rect x="8.9" y="12.8" width="4.1" height="1.3" rx=".55"/>' +
    "</svg>";

  // The four faces, asked for by name. Waiting on document.fonts.ready instead
  // is the trap: it resolves as soon as nothing is loading, and nothing is
  // loading until layout has asked for a face, so on a cold editor it can
  // resolve before the woff2 has been fetched at all. document.fonts.load()
  // starts the fetch here and hands back a promise about that face.
  const ROMAN_FACES = [
    '16px "Latin Modern Roman"',
    'italic 16px "Latin Modern Roman"',
    'bold 16px "Latin Modern Roman"',
    'italic bold 16px "Latin Modern Roman"',
  ];

  // And the same four again, twice, under the two names the engraving spends.
  // Two families of the same files, because the annotation is the one role
  // abcjs does not set in a Times and has to be drawn larger to be the size
  // it was; the stylesheet gives the numbers. They are warmed for the same
  // reason as the prose's and one more: abcjs measures the room a word needs
  // with the face that is in when it draws, so engraving against the fallback
  // lays the staff out for a face the reader never sees.
  const SCORE_FACES = [
    '16px "Latin Modern Roman Score"',
    'italic 16px "Latin Modern Roman Score"',
    'bold 16px "Latin Modern Roman Score"',
    'italic bold 16px "Latin Modern Roman Score"',
    '16px "Latin Modern Roman Score Wide"',
    'italic 16px "Latin Modern Roman Score Wide"',
    'bold 16px "Latin Modern Roman Score Wide"',
    'italic bold 16px "Latin Modern Roman Score Wide"',
  ];

  let textFont = SETTINGS.textFont || "roman";

  // The face the words on a staff are set in, or "" when the engraving keeps
  // the faces abcjs compiled in. It is read off the sheet (--mdm-score-face,
  // set with --mdm-text under #app.mdm-text--roman) rather than spelled here,
  // so the family is named once, beside the @font-face that declares it. Read
  // when the face changes and kept, because renderScore runs from a widget's
  // toDOM and a computed-style read there costs a style pass per score.
  let scoreFace = "";
  // And the second of them, for the annotation alone. Kept apart rather than
  // spelled as the first one plus a word, so that a family renamed in the
  // sheet is renamed in one place.
  let scoreFaceWide = "";
  // And whether the four files have been fetched, which is a separate thing
  // and has to be waited for. abcjs measures the room every word needs with
  // the face that is in when it draws, and keeps that measurement in a cache
  // of its own keyed by the string and the attributes it drew with (strings
  // under twenty characters, which is most of what a staff carries: a part
  // label, a chord, a syllable of a lyric). A score engraved under this
  // family's name before the woff2 lands is laid out by the fallback's
  // metrics and keeps that layout, redraw or no redraw. So a
  // score drawn before then is drawn as a sans document's is, in abcjs's own
  // faces, and engraved again the moment the face arrives, under a name abcjs
  // has not measured yet.
  //
  // Once for the session and never taken back: a document read in the sans
  // and turned to the roman later has the files already, so the turn costs no
  // engraving in the wrong face.
  //
  // document.fonts.check() is not the test for this, and was tried: on the
  // exported page it answers false for a face whose own load() has just
  // resolved, while other faces of the page are still loading.
  let scoreFacesIn = !(document.fonts && document.fonts.load);
  function readScoreFace(token) {
    const root = document.getElementById("app");
    if (!root || !window.getComputedStyle) return "";
    const named = getComputedStyle(root).getPropertyValue(token);
    return named ? named.trim() : "";
  }

  // The tip names the face the click leads to, not the one being read, and it
  // names it by what the reader would call it rather than by the name of the
  // file: the roman is the face of a LaTeX document, the sans is the face
  // Markdown is usually written in.
  function textFontTip() {
    return textFont === "roman" ? "Usual Markdown font" : "LaTeX font";
  }

  // Lit on the sans and not on the roman, which is the way round the rest of
  // the bar works: the roman is the default, and a lamp that is on from the
  // first time the editor opens says nothing. The staff-line and multicursor
  // toggles light the same way, on the setting that was asked for rather than
  // on the one that came with the editor.
  function updateTextFontButton() {
    const btn = document.querySelector('#app button[data-type="mdm-text-font"]');
    if (!btn) return;
    btn.setAttribute("aria-label", textFontTip());
    btn.classList.toggle("mdm-btn--on", textFont === "sans");
  }

  // The class the stylesheet hangs the face on, and then a re-measure.
  // CodeMirror keeps the width of a character and the height of a line in a
  // cache it only refills when its resize observer fires, and a face swap
  // changes both without changing the size of a single box the observer
  // watches: without the call the caret and the selection are drawn for a
  // page ago.
  //
  // The second re-measure is for the file arriving. The faces are asked for by
  // name here rather than left to be fetched when layout first wants one,
  // which is what closes the window in which CodeMirror can measure a
  // character against the fallback and draw the caret somewhere the text is
  // not. It showed up as one stray frame in the caret test on a loaded
  // machine, and only there: the fetch of a local woff2 is fast enough that on
  // an idle one the face was always in before the first measure.
  function applyTextFont() {
    const root = document.getElementById("app");
    if (!root) return;
    root.classList.toggle("mdm-text--roman", textFont === "roman");
    const wasFace = scoreFace + "/" + scoreFaceWide;
    scoreFace = readScoreFace("--mdm-score-face");
    scoreFaceWide = readScoreFace("--mdm-score-face-wide");
    updateTextFontButton();
    remeasureText();
    // Only when the face really moved, and only when it can be used. This
    // function runs on every settings message the host sends, which is every
    // change to any mdm.* setting, and an engraving thrown away and made
    // again costs a sounding score its playhead line and its timing walk. And
    // while the files are still on their way there is nothing to gain by
    // drawing now: that engraving could not name the face and would be
    // replaced by the one afterFacesArrive makes.
    if (
      scoreFace + "/" + scoreFaceWide !== wasFace &&
      (!scoreFace || scoreFacesIn)
    ) {
      engraveScoresAgain();
    }
    if (textFont !== "roman" || !document.fonts || !document.fonts.load) return;
    Promise.all(
      ROMAN_FACES.concat(SCORE_FACES).map(function (face) {
        return document.fonts.load(face);
      })
    ).then(afterFacesArrive, remeasureText);
  }
  // The faces are in. Not on the rejected branch, which is where the old
  // handler put both: Promise.all gives up on the first face that fails, so
  // taking that for arrival would name a family to abcjs with nothing loaded
  // behind it, which is the one thing this flag is here to prevent. A face
  // that never comes leaves the engraving in abcjs's own, as a sans document
  // is drawn, and the next settings message asks for it again.
  function afterFacesArrive() {
    const first = !scoreFacesIn;
    scoreFacesIn = true;
    remeasureText();
    // Only the arrival is worth an engraving. This resolves again on every
    // settings message, the files being in the browser's cache by then.
    if (first) engraveScoresAgain();
  }

  // ---------- Justified text ----------

  // Whether the prose is set to both edges of the column, the way a printed
  // page is, or ragged on the right, the way a browser sets text. Justified by
  // default. It is the same line breaking either way: Chromium justifies a
  // line after choosing where it breaks and only widens the spaces of the
  // lines it has, so the words a line ends on are the words it ended on
  // ragged, and the export's line by line test holds for both (html.test.js).
  // The last row of a paragraph is left alone, which is what `text-align:
  // justify` does with a last line and what TeX does with one.
  //
  // What moves is prose, the lines a paragraph, a list item, a quotation or a
  // callout is written on. Headings stay ragged, as they are on a printed page
  // and on the paper the export sets, and so does the source of a block being
  // edited, code, maths, the header, a table or HTML, which is set as typed
  // (style.css).
  //
  // The glyph is the one a word processor gives the command: three rows out
  // to both edges and a short last one. It stands apart from the staff lines
  // toggle, which is the same rows closed by barlines, by the missing
  // barlines and the short row, and the score alignment toggle no longer
  // draws text at all (ALIGN_ICON below).
  //
  // It works as the score alignment toggle does, at the owner's request: the
  // glyph and the tip name what the click leads to, and the button is never
  // lit, since the glyph that changes already says which way the text is
  // set. So justified text shows the ragged glyph (TEXT_RAGGED_ICON: the same
  // four rows, flush left and of four lengths) and ragged text shows this one.
  const TEXT_ALIGN_ICON =
    '<svg viewBox="0 0 16 16">' +
    '<rect x="1" y="2.3" width="14" height="1.4" rx=".7"/>' +
    '<rect x="1" y="5.7" width="14" height="1.4" rx=".7"/>' +
    '<rect x="1" y="9.1" width="14" height="1.4" rx=".7"/>' +
    '<rect x="1" y="12.5" width="8.4" height="1.4" rx=".7"/>' +
    "</svg>";

  const TEXT_RAGGED_ICON =
    '<svg viewBox="0 0 16 16">' +
    '<rect x="1" y="2.3" width="14" height="1.4" rx=".7"/>' +
    '<rect x="1" y="5.7" width="9.6" height="1.4" rx=".7"/>' +
    '<rect x="1" y="9.1" width="12.4" height="1.4" rx=".7"/>' +
    '<rect x="1" y="12.5" width="7.2" height="1.4" rx=".7"/>' +
    "</svg>";

  let textAlign = SETTINGS.textAlign || "justify";

  // The glyph of what the click leads to.
  function textAlignIcon() {
    return textAlign === "justify" ? TEXT_RAGGED_ICON : TEXT_ALIGN_ICON;
  }

  function textAlignTip() {
    return textAlign === "justify" ? "Align text left" : "Justify text";
  }

  function updateTextAlignButton() {
    const btn = document.querySelector('#app button[data-type="mdm-text-align"]');
    if (!btn) return;
    btn.setAttribute("aria-label", textAlignTip());
    btn.innerHTML = textAlignIcon();
  }

  // The class the stylesheet justifies the prose by. The carets and the
  // selection are drawn by CodeMirror from where the letters were when it
  // last measured, and widening the spaces moves every letter of a row but
  // its first without changing the height of a line or the width of the
  // column, which is all its measure looks at. So the selection is handed
  // back to the view as it stands: a transaction that sets a selection is
  // the one the layers redraw on, and it changes nothing else.
  function applyTextAlign() {
    const root = app();
    if (!root) return;
    const was = root.classList.contains("mdm-text--justify");
    root.classList.toggle("mdm-text--justify", textAlign === "justify");
    updateTextAlignButton();
    if (view && was !== (textAlign === "justify")) {
      view.dispatch({ selection: view.state.selection });
    }
  }

  // ---------- Word division ----------

  // A menu, like the theme and the score fill: its first entry keeps words
  // whole, which is the default, and each of the others divides them in one
  // of the languages the extension carries patterns for
  // (hyphenation-patterns.js). A language is two choices at once. Dividing
  // words at all is a look of the editor, mdm.hyphenation, kept with the
  // others and carried to the export as the face of the text is; the language
  // is the document's, so it goes into the header as `lang:`, the line Quarto
  // reads for the page and the paper. The host writes that line (setLanguage
  // in extension.js), with the header shown or hidden. "No hyphenation" turns
  // division off and leaves `lang:` alone: the document is still in the
  // language it names.
  //
  // The glyph is what the menu does to a word: an "a" and a hyphen ending one
  // line, and the "b" that finishes the word at the start of the next.
  // Filled, since the toolbar stylesheet sets stroke-width 0.
  const HYPHENATION_ICON =
    '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M5.56 1.1c1.8 0 2.85.85 2.85 2.47v3.42H7.08v-.57c-.47.47-1.14.76-1.9.76C3.85 7.18 2.9 6.42 2.9 5.28c0-1.23.95-1.9 2.56-1.9h1.61v-.1c0-.66-.47-1.04-1.42-1.04-.66 0-1.23.19-1.8.57l-.57-.95c.76-.47 1.52-.76 2.28-.76zM5.65 4.33c-.85 0-1.33.28-1.33.85 0 .47.38.85 1.04.85.85 0 1.61-.47 1.71-1.23V4.33z"/><rect x="9.4" y="3.75" width="3.6" height="1.45" rx=".72"/><path fill-rule="evenodd" d="M2.9 8.4h1.26v2.1c.42-.42 1.01-.67 1.68-.67 1.34 0 2.27 1.09 2.27 2.52s-.92 2.52-2.27 2.52c-.67 0-1.26-.25-1.68-.67v.5H2.9zm2.69 2.52c-.84 0-1.43.59-1.43 1.43s.59 1.43 1.43 1.43 1.34-.59 1.34-1.43-.5-1.43-1.34-1.43z"/></svg>';

  // Each language by the name it gives itself, in the order of those names,
  // which is how a list of languages is read. The host keeps the same tags
  // (LANGUAGES in extension.js), and the tests hold both to the patterns.
  const HYPHENATION_LANGUAGES = [
    { tag: "de", label: "Deutsch" },
    { tag: "en", label: "English" },
    { tag: "es", label: "Español" },
    { tag: "fr", label: "Français" },
    { tag: "it", label: "Italiano" },
    { tag: "nl", label: "Nederlands" },
    { tag: "pl", label: "Polski" },
    { tag: "pt", label: "Português" },
    { tag: "ru", label: "Русский" },
    { tag: "uk", label: "Українська" },
  ];

  // The language the document is in, read where the editor reads it to
  // divide words: the header in the text while the editor shows it, so that
  // a `lang:` being typed counts at once, and the host's copy while hidden.
  // Whether the text carries the header is the flag of the update it came
  // with and not the parse: while the file's header is kept aside, a header
  // at the top of the text is a block typed under it, and the export reads
  // the language from the file's first header (langOf in transforms.js).
  function documentLanguage(state) {
    const fm = editorFrontMatter && CM.syntaxTree(state).topNode.getChild("FrontMatter");
    return window.MDM_HYPHENATION.language(
      fm ? state.doc.sliceString(fm.from, fm.to) : headerText
    );
  }

  // The entry the tick goes on: the document's language by its base tag
  // (es-CU is Español) while that language is dividing the prose, and "No
  // hyphenation" whenever nothing is: division off, a header that names no
  // language (language() in mdm-hyphenation.js says why that one is not taken
  // for English) or a language without patterns. The tick says what the page
  // is doing, so there is always exactly one.
  function hyphenationChoice() {
    if (hyphenation !== "auto" || !view) return "none";
    const lang = documentLanguage(view.state).split("-")[0];
    return HYPHENATION_LANGUAGES.some(function (entry) {
      return entry.tag === lang;
    }) ? lang : "none";
  }

  // Lit while a language is dividing the prose, which is while the tick is on
  // a language. Off, a header naming no language and a language without
  // patterns all keep the words whole and leave the button dark: the lamp
  // marks what was asked for and is being done, as on the rest of the bar.
  // The export divides exactly when it is lit (exportHyphenation in
  // extension.js).
  function updateHyphenationButton() {
    const btn = document.querySelector('#app button[data-type="mdm-hyphenation"]');
    if (!btn) return;
    btn.classList.toggle("mdm-btn--on", hyphenationChoice() !== "none");
  }

  // Rebuilt each time the panel opens (a `build` panel, see toolbarButton),
  // so the tick follows a `lang:` typed into the header as well as the
  // setting.
  function hyphenationMenuItems() {
    const choice = hyphenationChoice();
    return [{ tag: "none", label: "No hyphenation" }]
      .concat(HYPHENATION_LANGUAGES)
      .map(function (entry) {
        return {
          name: "mdm-hyphenation-" + entry.tag,
          label:
            entry.label +
            (entry.tag === choice ? '<span class="mdm-swatch__tick">✓</span>' : ""),
          click: function () {
            if (entry.tag === "none") {
              askSetting("hyphenation", "none");
              return;
            }
            // An edit still waiting out its debounce goes first. With the
            // header shown it carries the header as it was, and landing after
            // the new `lang:` it would put the old one back.
            flushEdit();
            vscode.postMessage({ type: "setLanguage", lang: entry.tag });
            askSetting("hyphenation", "auto");
          },
        };
      });
  }

  function applyHyphenation() {
    const root = app();
    if (!root) return;
    root.classList.toggle("mdm-hyphenation--on", hyphenation === "auto");
    updateHyphenationButton();
    if (view) view.dispatch({ effects: refreshHyphenation.of(null) });
    remeasureText();
  }

  // ---------- Score alignment button ----------

  // Where a score sits across the page. Centred by default, like display maths;
  // left aligns it with the text, which is what a run of narrow scores wants so
  // they do not wander from block to block. Only scores narrower than the pane
  // move: a full-width one fills the line either way.
  //
  // Same convention as the theme button: the icon and the tooltip name what the
  // click does, not the state in use, so the centred glyph shows while the
  // scores are left-aligned.
  //
  // A quarter note between a line of text over it and one under it, standing
  // at the left edge or in the middle. The glyph used to be the bars of a
  // text-alignment icon, which was unambiguous while nothing else on the bar
  // aligned anything; with the prose justified from the toggle beside the
  // hyphenation menu (TEXT_ALIGN_ICON) two sets of bars would have left a
  // reader guessing which one moves the words, so this one draws the music
  // it moves. The owner's pick of the six in design-text-align-icon.html: a
  // staff with a head on it ran together into a smudge at 15px, and one
  // closed by barlines read as a box.
  // The two lines of text and the stem are drawn at 1.5, a shade heavier than
  // the 1.3 rules of the playhead toggle (FOLLOW_ICON). The lines stand at the
  // very edges of the box so the note takes the room left between them. The
  // owner's corrections, in turn: the first 0.95 drawing was lighter than the
  // rest of the bar, 1.3 made all three marks even with the playhead, and the
  // whole glyph wanted one last small lift. The head is
  // 2.2 by 1.55 tilted 25 degrees, and the stem stands on its rightmost point,
  // 2.1 right of its centre, and runs down to the centre inside it: stood off
  // the head and stopped short, its rounded foot left a notch between head and
  // stem that read as a gap. Head and stem span 2.1 either side of the centre,
  // so the centred one is at 8 and the left one at 3.1. Filled, since the
  // toolbar stylesheet sets stroke-width 0.
  const ALIGN_ICON = {
    center:
      '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="1.5" rx=".75"/><ellipse cx="8" cy="11" rx="2.2" ry="1.55" transform="rotate(-25 8 11)"/><rect x="8.6" y="3.4" width="1.5" height="7.6" rx=".75"/><rect x="1" y="13.5" width="14" height="1.5" rx=".75"/></svg>',
    left:
      '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="1.5" rx=".75"/><ellipse cx="3.1" cy="11" rx="2.2" ry="1.55" transform="rotate(-25 3.1 11)"/><rect x="3.7" y="3.4" width="1.5" height="7.6" rx=".75"/><rect x="1" y="13.5" width="14" height="1.5" rx=".75"/></svg>',
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

  // Whether the YAML header is part of the document in the editor. Shown, it
  // is the first lines of the text, --- fences included, painted as a card and
  // highlighted as YAML; hidden, the host keeps it out of the text and splices
  // it back on every edit (transforms.js).
  //
  // The glyph is the header as typed: a --- fence, a line of YAML, and the
  // closing --- fence.
  const FM_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="2.8" width="3.6" height="1.4" rx=".7"/><rect x="6.2" y="2.8" width="3.6" height="1.4" rx=".7"/><rect x="11.4" y="2.8" width="3.6" height="1.4" rx=".7"/><rect x="1" y="7.3" width="14" height="1.4" rx=".7"/><rect x="1" y="11.8" width="3.6" height="1.4" rx=".7"/><rect x="6.2" y="11.8" width="3.6" height="1.4" rx=".7"/><rect x="11.4" y="11.8" width="3.6" height="1.4" rx=".7"/></svg>';

  let headerText = "";

  // The button reads the text and not the setting: a header typed into a
  // document while the setting keeps headers out stays in the text (the host
  // says so with the update that follows the edit), and the button then
  // offers to hide it, which is what a press does.
  function fmTip() {
    if (headerText === "") return "No YAML header in this file";
    return editorFrontMatter ? "Hide YAML header" : "Show YAML header";
  }

  function updateFrontMatter() {
    const btn = document.querySelector(
      '#app button[data-type="mdm-front-matter"]'
    );
    if (!btn) return;
    btn.setAttribute("aria-label", fmTip());
    btn.classList.toggle(
      "mdm-btn--on",
      editorFrontMatter && headerText !== ""
    );
    // Nothing to show for a file without a header, so the button greys out.
    btn.classList.toggle("mdm-btn--off", headerText === "");
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
    // The menu lights while a fill is on, the way the hyphenation menu does
    // while a language divides: None is the default, and dark.
    const btn = document.querySelector('#app button[data-type="mdm-score-fill"]');
    if (btn) btn.classList.toggle("mdm-btn--on", !!color);
  }

  function fillMenuItems() {
    const items = Object.keys(SCORE_FILL).map(function (key) {
      return {
        name: "mdm-score-" + key,
        label: fillMenuLabel(key),
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

  // The two sides hold one document and both write to it: this editor with
  // every keystroke, the host with whatever changes the file under it (the
  // text editor open beside this one, a formatter, the header button, the
  // language the hyphenation menu writes). Each side sends the other the
  // whole text, and what keeps the two from writing over each other is a
  // record of what they last agreed on:
  //
  // - `synced` is the text the host has acknowledged holding, and
  //   `unconfirmed` the changes made here since, as one ChangeSet from that
  //   text to the document on screen. A text that arrives from the host is
  //   measured against `synced`, never against the screen: the difference is
  //   the host's own change, and it is mapped over `unconfirmed` before it is
  //   applied, so an edit typed here while the host was writing survives on
  //   both sides instead of being dropped (an update that arrived inside the
  //   300 ms debounce used to be thrown away, and the debounced edit then
  //   wrote the stale text over the host's change, silently).
  // - Every edit sent carries `base`, the version of the document the host
  //   last reported, and a `seq` of its own. The host answers with `applied`
  //   and that seq once the text is in the document, which is when `synced`
  //   moves to it; the sends still waiting are kept (`outstanding`) with the
  //   changes made after each, so an acknowledgement for any of them, in any
  //   order, leaves `unconfirmed` right. An edit based on a version the host
  //   has moved past through a change of its own is not applied there: the
  //   host sends the document instead, this side merges and sends again.
  let synced = "";
  let unconfirmed = null;
  let seq = 0;
  let base = undefined;
  let outstanding = [];

  function editorText() {
    return view ? view.state.doc.toString() : "";
  }

  // The document the editor was built on is what both sides hold.
  function startSync(text) {
    synced = text;
    unconfirmed = CM.ChangeSet.empty(text.length);
    outstanding = [];
  }

  // A change made in this editor, on its way to the host.
  function noteLocalChange(changes) {
    unconfirmed = unconfirmed.compose(changes);
    outstanding.forEach(function (sent) {
      sent.since = sent.since.compose(changes);
    });
  }

  function sendEdit() {
    const text = editorText();
    seq++;
    outstanding.push({ seq: seq, text: text, since: CM.ChangeSet.empty(text.length) });
    vscode.postMessage({
      type: "edit",
      text: text,
      withFrontMatter: editorFrontMatter,
      seq: seq,
      base: base,
    });
  }

  // The host has written the text sent as `seq`: that text is what the two
  // sides now agree on, and what was typed after sending it is what is left
  // to confirm. Sends older than it were superseded by it (each carries the
  // whole text) and are let go with it.
  function editApplied(msg) {
    const at = outstanding.findIndex(function (sent) {
      return sent.seq === msg.seq;
    });
    if (at === -1) return;
    const sent = outstanding[at];
    synced = sent.text;
    unconfirmed = sent.since;
    outstanding = outstanding.slice(at + 1);
    if (msg.version !== undefined) base = msg.version;
  }

  function queueEdit() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = null;
      sendEdit();
    }, 300);
  }

  // On blur, or when the webview is hidden, the pending debounce is sent right
  // away: otherwise closing the tab just after typing would lose the last
  // ~300 ms of writing.
  function flushEdit() {
    if (!pending || !view) return;
    clearTimeout(pending);
    pending = null;
    sendEdit();
  }
  window.addEventListener("blur", flushEdit);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushEdit();
  });

  // The stretch that differs between two texts, as a ChangeSet over the
  // first: the common head and tail are left alone, so the carets, the undo
  // history and the rendered widgets outside the change all survive an
  // external edit.
  function textDiff(from, to) {
    let head = 0;
    const max = Math.min(from.length, to.length);
    while (head < max && from.charCodeAt(head) === to.charCodeAt(head)) head++;
    let tail = 0;
    while (
      tail < max - head &&
      from.charCodeAt(from.length - 1 - tail) === to.charCodeAt(to.length - 1 - tail)
    ) {
      tail++;
    }
    return CM.ChangeSet.of(
      { from: head, to: from.length - tail, insert: to.slice(head, to.length - tail) },
      from.length
    );
  }

  // A text from the host, merged into the document on screen: its change
  // against the last agreed text is mapped over what was typed here since,
  // and what was typed here is mapped over it, the way two writers of one
  // document are reconciled (@codemirror/collab does the same, with the same
  // tie-break: the host's insertion goes after a local one at the same
  // spot). Whatever is left unconfirmed is sent again on the new base.
  //
  // The change is kept out of the undo history: it is the host's, and
  // undoing it here put the file back the way the host had just changed it
  // (Ctrl+Z after the header button deleted the header from the file, or
  // wrote it twice). The history maps its own events over it instead.
  // The host's own account of an outside change, as a change over the agreed
  // text, or null when it does not lead from that text to the one that came
  // with it (the two sides may have parted over an edit in flight, or the
  // change touched lines this editor does not hold): the texts are compared
  // then. It says where a change was made, which the texts alone do not when
  // a line goes in among lines like it (G090).
  function explicitChanges(from, to, changes) {
    try {
      const text = CM.Text.of(from.split("\n"));
      const at = function (p) {
        return text.line(p.line + 1).from + p.ch;
      };
      const set = CM.ChangeSet.of(
        changes.map(function (c) {
          return { from: at(c.from), to: at(c.to), insert: c.text };
        }),
        text.length
      );
      return set.apply(text).toString() === to ? set : null;
    } catch (e) {
      return null;
    }
  }

  function replaceText(incoming, version, changes) {
    // The text of this editor is LF (the host sends it that way, see
    // transforms.js). A CR that got through would not survive the dispatch
    // either: CodeMirror splits an inserted string on /\r\n?|\n/, so the lone
    // CR left at the end of the replacement below would come out as one more
    // line break, and the document would gain a blank line per update.
    const next = incoming.replace(/\r\n?/g, "\n");
    if (version !== undefined) base = version;
    // Every send still out is either already acknowledged (the answer came
    // before this text) or based on a version this text has moved past, and
    // the host will not write it: what it carried is still in `unconfirmed`
    // and goes out again below.
    outstanding = [];
    // The text on screen already: the two sides have come to one text by two
    // roads, and there is nothing to merge. Inside VS Code Ctrl+Z is undone
    // twice, here by CodeMirror's history and in the workbench, which undoes
    // the text model under this editor and sends the text that leaves. The
    // two undos take out one change, but not always at one place: the host
    // writes an edit over the stretch a comparison of the texts finds, and a
    // line put in among blank lines is found at the end of the run where
    // CodeMirror put it at the head. Mapped over each other as two writers'
    // changes, they took out one line break more than had gone in (reported
    // from VS Code: the code block button on a blank line and then Ctrl+Z
    // lost the line, on screen and in the file; a plain Enter there as well).
    if (next === view.state.doc.toString()) {
      synced = next;
      unconfirmed = CM.ChangeSet.empty(next.length);
      return;
    }
    const hostChanges = (changes && explicitChanges(synced, next, changes)) || textDiff(synced, next);
    synced = next;
    if (!hostChanges.empty) {
      const mapped = hostChanges.map(unconfirmed);
      unconfirmed = unconfirmed.map(hostChanges, true);
      if (!mapped.empty) {
        applying = true;
        try {
          view.dispatch({
            changes: mapped,
            annotations: [CM.Transaction.remote.of(true), CM.Transaction.addToHistory.of(false)],
          });
        } finally {
          applying = false;
        }
      }
    }
    if (!unconfirmed.empty) queueEdit();
  }

  // abcjs sizes its SVG with width/height attributes and leaves out the
  // viewBox, so a score wider than the pane gets its viewport shrunk by the
  // max-width rule while the drawing keeps its original coordinates: the
  // bottom and the right end are cropped. The viewBox rebuilt from those two
  // attributes makes the whole thing scale down instead. Runs on every render
  // pass, so scores that appear later are covered as well.
  //
  // Those attributes are not always the whole drawing either: an older abcjs
  // (5.10.3) sized the SVG from the engraved music alone and a title wider
  // than the staff hung outside the viewport. getBBox() gives the real extent,
  // and the box written here is the union of the two, so nothing is ever
  // cropped and a score that already fits keeps its size. The width/height
  // attributes grow with it: leaving them at the declared value would squeeze
  // the union into a narrower viewport, scaling the score down.
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
        // The drawing's own width, which a fill's side padding gives way to
        // (#app.mdm-score--filled code.language-abc in style.css).
        const card = svg.closest("code.language-abc");
        if (card) card.style.setProperty("--mdm-score-natural", w + "px");
        if (box) svg.setAttribute("data-mdm-fit", "1");
      });
  }

  // Clicking a note makes abcjs highlight it: it writes fill="#ff0000" on the
  // shape and tags it abcjs-note_selected, and nothing here wires its
  // selection controller, so the red would stay for good. In this editor a
  // click on a score already means something else, open its ABC source, and
  // nothing reads the selection, so it is undone right after abcjs writes it. Restore
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

  // The highlight is an attribute change, which the content observer does not
  // watch, and abcjs writes it from its own handler on the shape. Hence a
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

  // The copy button of a code block, a display equation or a score, in the
  // rail beside the block (widget chrome, see handleChromeClick and
  // `#app .mdm-chrome` in style.css): the source goes to the clipboard
  // through the clipboard API, nothing is selected, and the block that was
  // copied gives a brief pulse of its own background as the feedback.
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
  // the first line of the rendered code.
  function pulseBlock(el) {
    const code = el && el.querySelector ? el.querySelector("code.language-abc") || el : el;
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

  // Off-screen textarea fallback: the element sits outside the viewport, so
  // nothing visible gets selected.
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

  // ---------- Audio ----------

  // Each score gets a small button over its copy button that opens a player
  // bar in the toolbar, as a row of its own (see openPlayer for why it is not
  // under the score); play sounds the tune. The synthesizer is the abcjs
  // 6.7.0 vendored in media/vendor/abcjs (the same engine the Quarto HTML
  // uses, and the one that engraves the scores on screen). The soundfont is a
  // piano vendored in media/vendor/soundfont, so playback needs no network at
  // all. The tune the synth plays is engraved again invisibly at mount, so
  // that its object comes from the same call that will play it.
  //
  // The engine is loaded by the page before this script; the promise shape
  // stays so the mount reads the same whether or not it ever has to wait.
  function loadAbcjs6() {
    return window.ABCJS
      ? Promise.resolve(window.ABCJS)
      : Promise.reject(new Error("abcjs unreachable"));
  }

  // The one open player: { pos, block, bar, controller, source, repaint }. One
  // at a time on purpose, two tunes sounding over each other serve nobody;
  // opening a second score closes the first. `pos` is the position in the
  // document its block ends at, the identity that survives CodeMirror
  // rebuilding the widget when the source is edited and the only one there is
  // now that the bar has left the block (playerBlock); `block` is the widget
  // last found at that position, kept so the frame loop need not look it up
  // again; `repaint` puts the progress head back where the width it was drawn
  // at has moved (makeProgressDraggable).
  let player = null;

  // The on-screen engraving of each score, keyed by its <code>. The player
  // needs it to light up the notes as they sound: the engraved elements
  // remember the chars of source they came from, and so do the synth's
  // events, so the two engravings (on screen and in the synth) meet on the
  // source text.
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
  // The graph alone, without waking the output: an export renders its notes
  // into a buffer and sounds nothing, so it needs a context to render in and
  // none of the pilot tone that keeps a speaker from dozing between notes.
  function makeAudioGraph() {
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
  }

  function ensureAudioGraph() {
    makeAudioGraph();
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
      if (player) return;
      // An export holds the context too: it renders through the same graph,
      // and prime() waits on a resume() that a suspended context never gives
      // back (audioExports, see the export section below). The minute begins
      // again rather than being spent here: this timer is the only one there
      // is, and swallowing it left the pilot sounding into an editor nobody
      // was playing anything in.
      if (audioExports) {
        restAudioWhenIdle();
        return;
      }
      restAudio();
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
      // A tune sounding keeps the output, and so does an export in flight: a
      // hidden panel goes on rendering, and a context suspended under it
      // would leave prime() waiting for good.
      if (!playerSounding() && !audioExports) restAudio();
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
    mute.className = "mdm-audio-mute mdm-tip mdm-tip--s";
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

  // The percent a hand is holding the progress head at, and null the rest of
  // the time. The playing cursor reads it (cursorFrame): while the head is
  // held, and until the engine's seek lands after the release, the line on
  // the score follows the hand instead of the clock, so scrubbing moves the
  // two together the way it does in any sequencer. Written by the drag
  // below; the engine is deliberately not seeked during the drag (see the
  // note on midiBuffer.seek), which is why the line cannot read the clock
  // for this.
  let cursorDrag = null;

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

    // The head is placed by abcjs in pixels, off the track's clientWidth at
    // the moment it is drawn (checked in the bundle: `left = clientWidth *
    // percent`), while the fill beside it is a percentage of the same track.
    // A row as wide as the pane is dragged narrower and wider all the time,
    // and the two would come apart: the fill follows, the head stands where
    // the old width put it. While the tune runs the timer redraws it on the
    // next reading; paused, stopped or never played, nothing does, so the
    // width watcher (watchPlayerWidth) asks for it here, off the number the
    // head was last drawn from.
    if (player && player.bar === bar) {
      player.repaint = function () {
        if (!dragging) paint(head, totalMs());
      };
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
        else if (asked !== null) return runSeek();
        // The queue is spent (or was never servable): the clock now stands
        // where the last gesture asked, so the playing cursor is handed back
        // to it. Not a frame sooner: cleared on the release itself, the line
        // fell back to the old clock for the beat the seek takes to land and
        // flicked there and back.
        cursorDrag = null;
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
          // Where the music now is, brought on screen. Here rather than in
          // seek(), because until this call the clock still stands where the
          // gesture started and the cursor would be measured at the old
          // position. This is what covers the gestures that never send a
          // pointermove: the arrow keys, Home and End, and a plain click on
          // the track.
          revealPlayhead();
          return Promise.resolve();
        }, null)
        .then(done, done);
    }

    track.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      dragging = true;
      // A hand on the head silences the score. The engine cannot seek at
      // pointermove rate (see above), and pausing it here is no good either:
      // the pause and the release's seek travel separate abcjs promise
      // chains, and on a quick click (down and up milliseconds apart, the
      // plain jump gesture) the pause landed AFTER the seek and the resume
      // picked up a stale position, sound at the old spot under a clock
      // standing on the new one (measured on the timing fixture). So the
      // transport is left running and the OUTPUT is muted for the drag, on
      // the same mute stage the resume gap uses; the release's seek then
      // goes down the sounding path it always did, and its silent gap takes
      // the stage over and lifts it on the next attack (scheduleSilentGap).
      //
      // The ink goes out with the sound, and stays out for the drag (the
      // cursorDrag guard in onEvent keeps the muted notes passing under the
      // old position from lighting): what is lit is where the music stands,
      // and the head is leaving it. The seek of the release marks whatever
      // it lands on, so the ink comes back the moment it means something.
      // clearResumeHold first: it puts the mute stage back to one and
      // cancels paints deferred by a resume gap, which would land after
      // this clear and light a note the head has left.
      clearResumeHold();
      clearPlayingHighlight();
      if (isSounding(bar) && audioMute && audioCtx) {
        try {
          audioMute.gain.cancelScheduledValues(audioCtx.currentTime);
          audioMute.gain.setValueAtTime(0, audioCtx.currentTime);
        } catch (err) {
          // a context torn down mid-flight
        }
      }
      cursorDrag = pointerPercent(e.clientX);
      paint(cursorDrag, totalMs());
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
      cursorDrag = pointerPercent(e.clientX);
      paint(cursorDrag, totalMs());
      revealPlayhead(); // the score follows the head as it is dragged
    });
    track.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false;
      seek(pointerPercent(e.clientX));
    });
    track.addEventListener("pointercancel", function () {
      if (!dragging) return;
      dragging = false;
      cursorDrag = null; // the line goes back onto the clock with the head
      paint(controller.percent || 0, totalMs()); // back onto the playhead
      // An abandoned drag seeks nothing: the mute the grab set is lifted and
      // the tune goes on sounding from wherever it has silently got to.
      clearResumeHold();
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
  //    editor uses (the copy button included), drawn from aria-label
  //    (.mdm-tip in style.css); the title is dropped so that nothing shows
  //    it twice.
  //    Drawn south, the way the toolbar's own buttons draw theirs: the bar is
  //    a row of that toolbar now, with the buttons directly above it, so a
  //    tooltip drawn north would be laid over them. Below there is nothing
  //    but the text, which a tooltip is allowed to cover (the toolbar is a
  //    stacking context of its own above the editor).
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
    button.className = "abcjs-btn mdm-audio-stop mdm-tip mdm-tip--s";
    button.setAttribute("aria-label", "Stop");
    button.innerHTML = STOP_ICON;
    button.addEventListener("click", function () {
      const start = bar.querySelector(".abcjs-midi-start");
      if (start && start.classList.contains("abcjs-pushed")) start.click();
      // The rewind waits a microtask on that pause. abcjs finishes pausing
      // after the click returns and writes down where the sound stopped as it
      // does, so a restart in the same tick was undone by it: the clock, the
      // head and the ink went back to the top while the buffer stayed where it
      // was, and the next play sounded from there (measured: stop at 450 ms,
      // then play, and the sound came in 450 ms into the tune while the ink
      // ran from the beginning).
      Promise.resolve().then(function () {
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
    });
    return button;
  }

  // The player is shut from the bar as well as from the score. The headphones
  // in the rail of a score are the only other way, and a score can be a page
  // long or scrolled clean off the screen, so closing what you are
  // listening to meant going to find the score again. This is the same
  // drawing, lit the way that one is lit while its player is open, and it
  // does the same thing.
  //
  // It is the one button of the bar that is lit at rest, and it has to be:
  // the lit disc is what says "this is on", and a player with a bar on
  // screen always is. That costs it the two steps of the brass ladder the
  // other buttons use (a wash under the pointer, the state weight for what
  // is held), since it already stands on the second, so the stylesheet gives
  // it a third and deeper step for the hover alone.
  //
  // No state to keep and no label to flip: there is one thing it can do.
  function closeButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "abcjs-btn mdm-audio-close mdm-tip mdm-tip--s";
    button.setAttribute("aria-label", "Hide player");
    button.innerHTML = HEADPHONES_BAR_ICON;
    button.addEventListener("click", function () {
      closePlayer();
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
    // After repeat, which is the end of the transport: the buttons that work
    // the tune first, then the one that puts the player away.
    const close = closeButton();
    if (loop) loop.insertAdjacentElement("afterend", close);
    else widget.insertBefore(close, widget.firstChild);
    [start, loop].forEach(function (button) {
      if (!button) return;
      button.classList.add("mdm-tip", "mdm-tip--s");
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
    const code = block && block.querySelector("code.language-abc");
    const visual = code && SCORE_VISUALS.get(code);
    const engraver = visual && visual.engraver;
    return engraver && engraver.staffgroups ? engraver : null;
  }

  // The engraver keeps the elements it has lit in `selected`; this puts
  // their ink back. abcjs 6 has no clearSelection on the controller (5.x
  // had), only the per-element unhighlight its own rangeHighlight uses.
  function clearEngraverSelection(engraver) {
    if (typeof engraver.clearSelection === "function") {
      engraver.clearSelection();
      return;
    }
    const color =
      (engraver.renderer && engraver.renderer.foregroundColor) || "#000000";
    (engraver.selected || []).forEach(function (el) {
      try {
        el.unhighlight(undefined, color);
      } catch (e) {
        // an element re-engraved out from under the selection
      }
    });
    engraver.selected = [];
  }

  // Every stretch of source sounding at one moment. The event names one of
  // them in startChar/endChar, and only one: abcjs fills that pair from the
  // first note it walks into the group and leaves it alone, while every note
  // of the group, that one included, goes into startCharArray/endCharArray.
  // In a duet those are the parts on the other staves, sounding together, so
  // a range read off the pair alone lights the voice that was engraved first
  // (the top staff) and leaves the rest of the system in ink.
  function soundingRanges(ev) {
    const starts = (ev && ev.startCharArray) || [];
    const ends = (ev && ev.endCharArray) || [];
    const ranges = [];
    for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
      if (typeof starts[i] === "number" && typeof ends[i] === "number") {
        ranges.push([starts[i], ends[i]]);
      }
    }
    // An event that carries no arrays still lights the note it does name.
    if (!ranges.length && ev && typeof ev.startChar === "number") {
      ranges.push([ev.startChar, ev.endChar]);
    }
    return ranges;
  }

  // What the engraver's own rangeHighlight does (walk the engraved elements,
  // light the ones whose chars intersect a sounding range), but with a colour
  // of ours: highlight() hardwires its default to the selection red. And with
  // every range the event carries, so that the voices of a duet light on
  // their own staves together.
  function highlightPlaying(ev) {
    const engraver = playerDisplayEngraver();
    if (!engraver) return;
    const ranges = soundingRanges(ev);
    clearEngraverSelection(engraver);
    let root = null;
    engraver.staffgroups.forEach(function (group) {
      group.voices.forEach(function (voice) {
        voice.children.forEach(function (child) {
          const elem = child.abcelem;
          if (
            elem &&
            ranges.some(function (range) {
              return range[1] > elem.startChar && range[0] < elem.endChar;
            })
          ) {
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

  // The fill goes back to the black abcjs draws with, which is also what
  // the dark-side repaint keys on.
  function clearPlayingHighlight() {
    const engraver = playerDisplayEngraver();
    if (engraver) clearEngraverSelection(engraver);
  }

  // ---- The playing cursor ----
  //
  // A brass line that walks the score while the tune runs, the way tab
  // editors and sequencers draw their playhead: gliding, never hopping, so a
  // note reads as being inked the moment the line reaches it
  // (highlightPlaying lights it on the same clock). The path is abcjs's own:
  // setTiming hands every event the x it sits at (left) and the x its
  // stretch of time walks to (endX: the next attack, the end of the staff
  // before a line break, or the repeat bar it goes back from), so between
  // attacks the line moves through left..endX linearly, the same
  // interpolation the engine's beat callback does. Rests are events too, so
  // the line keeps walking through them while the ink stays off.
  //
  // Drawn on the engraving on screen, clocked by the synth, which plays an
  // engraving of its own (mountSynth): the synth's positions belong to that
  // invisible layout, laid out with other paddings, so only its clock is
  // read, and carried over as a fraction of the whole. That mapping is
  // exact, not approximate: the two timings come from one tempo map scaled
  // uniformly, so every event sits at the same fraction of the total in
  // both.
  //
  // The line is an element inside the score's own SVG, placed in its user
  // units, so the scale that fits a wide score to the pane (fitScores)
  // moves it with the notes for free. It is found or made again every frame
  // because CodeMirror rebuilds the widget, SVG and all, whenever the block
  // comes back into the viewport or its source changes.
  const CURSOR_TIMINGS = new WeakMap(); // on-screen visual -> events and total

  // The walkable events of the on-screen engraving, and the length of its
  // clock. Type "event" with a real x: a measure that begins with nothing
  // attacking gets a placeholder with left null, which the engine's own
  // callback skips the same way. Computed once per engraving; an edit puts
  // a new visual in SCORE_VISUALS and the walk is done again.
  function cursorTimings(visual) {
    if (CURSOR_TIMINGS.has(visual)) return CURSOR_TIMINGS.get(visual);
    if (!visual.engraver || !visual.engraver.staffgroups) return null;
    let timings = [];
    try {
      timings = visual.setTiming() || [];
    } catch (e) {
      // a tune the walker cannot time is a cursor that stays away
    }
    const events = timings.filter(function (t) {
      return t.type === "event" && typeof t.left === "number";
    });
    const last = timings[timings.length - 1];
    const total = last && last.type === "end" ? last.milliseconds : 0;
    const out =
      events.length && total > 0 ? { events: events, total: total } : null;
    CURSOR_TIMINGS.set(visual, out);
    return out;
  }

  // Where the line stands at a moment of the on-screen clock: the event the
  // moment falls in, its x walked forward by the share of the event's
  // stretch that has passed, and the vertical reach of the system it sits
  // on (every event carries the top and bottom of its whole staff group, so
  // on a duet one line crosses both staves).
  function cursorPlace(timing, at) {
    const events = timing.events;
    let lo = 0;
    let hi = events.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (events[mid].milliseconds <= at) lo = mid;
      else hi = mid - 1;
    }
    const ev = events[lo];
    const next =
      lo + 1 < events.length ? events[lo + 1].milliseconds : timing.total;
    const span = next - ev.milliseconds;
    let frac = span > 0 ? (at - ev.milliseconds) / span : 1;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    const endX = typeof ev.endX === "number" ? ev.endX : ev.left;
    return {
      x: ev.left + (endX - ev.left) * frac,
      top: ev.top,
      bottom: ev.top + ev.height,
    };
  }

  // Whether the ink is standing on something. With the clock at nought that
  // is what tells a head parked on the very top (a Home while paused, which
  // lights the first note) from a tune stopped or never started, where the
  // cursor has no business showing.
  function inkOn() {
    const engraver = playerDisplayEngraver();
    return !!(engraver && engraver.selected && engraver.selected.length);
  }

  // ---- Bringing the pane to the playhead ----
  //
  // A score can be a page long, and the music is only worth watching if it is
  // on screen. Two things take the pane to it, and both end in showPlayhead.
  //
  // A seek is one. Scrubbing the progress bar is a way of moving through the
  // SCORE: dropping the head halfway through duet.mdm puts the music on a
  // staff system that may be nowhere near the pane, and the reader is left
  // listening to something they cannot see. So a seek scrolls the pane to the
  // system the head has landed on, and follows the head live while it is
  // dragged.
  //
  // Following a drag live is safe here in a way it would not have been under
  // the score: the bar is a row of the toolbar, outside the scroller, so the
  // page can move as much as it likes without the track sliding out from
  // under the pointer holding it.
  //
  // A tune sounding is the other (followPlayhead, called from the frame loop),
  // and what it keeps true is one sentence: the staff system being played
  // stays whole on the pane. Asked every frame and answered only when part of
  // that band would leave it, so a score that fits the pane is never scrolled
  // at all, and the page is still while a line of music is played, since the
  // head does not go down the page inside a system.
  //
  // The band is the cursor's own box, top to bottom of the staff group
  // (cursorPlace reads that reach off the event, so a duet's two staves are
  // one band). A system showing whole is one the reader can follow, wherever
  // on the pane it happens to sit, and asking for nothing beyond that is the
  // point: the guard used to want 24px of room to spare at each edge as well,
  // which took a system resting a dozen pixels off an edge, perfectly
  // readable, and threw the page half a pane to centre it. The slack below is
  // rounding on a fractional rect and nothing more.
  //
  // The other thing that changed with the toolbar toggle: the page used to
  // move at the crossing from one system to the next and nowhere else, which
  // left a reader who could not see the head a line of music to wait through.
  // Reading past a playing score is what the toggle is for now, so with it on
  // the follow can simply follow.
  //
  // A score scrolled clean out of CodeMirror's viewport leaves no engraving to
  // read a place off, and is not followed: the music goes on sounding,
  // reachable from the row in the toolbar, and is picked up again when the
  // score comes back within the pane's reach. That branch is all but out of
  // reach while following is on, since the page comes back the frame after it
  // is scrolled and the reader never gets far enough for CodeMirror to throw
  // the widget away. It is the shape of the code that is left; the case
  // belongs to the toggle.
  const REVEAL_SLACK = 1;
  let revealPending = false;

  function revealPlayhead() {
    // The one gate, so the rule has no exceptions to remember: with the
    // follow off the music never moves the page, a scrub of the progress bar
    // included. A reader who turned it off asked for the document to stand
    // still, and a head dragged across a tune they are not watching is no
    // reason to take it from them.
    if (!following) return;
    if (revealPending) return; // one move per frame, however fast the drag
    revealPending = true;
    requestAnimationFrame(function () {
      revealPending = false;
      showPlayhead(0);
    });
  }

  // `tries` bounds the wait for something to measure: the cursor is drawn by
  // the frame loop, and a widget CodeMirror has thrown away comes back a
  // frame after it is asked for.
  function showPlayhead(tries) {
    if (!player || !view) return;
    const block = playerBlock();
    if (!block) {
      // Scrolled far enough out that CodeMirror keeps no widget: ask it for
      // the block's position, and come back for the system on the next frame,
      // when the engraving exists again.
      if (tries > 1) return;
      try {
        view.dispatch({
          effects: CM.EditorView.scrollIntoView(player.pos, { y: "center" }),
        });
      } catch (e) {
        return; // a position the document no longer has
      }
      requestAnimationFrame(function () {
        showPlayhead(tries + 1);
      });
      return;
    }
    const line = block.querySelector("code.language-abc svg .mdm-play-cursor");
    if (!line) {
      // The cursor is drawn from the frame loop, which may not have run since
      // the seek landed. One frame is enough; after that there is nothing
      // being played to show (a stopped tune draws no cursor) and the pane is
      // left where the reader put it.
      if (tries > 1) return;
      requestAnimationFrame(function () {
        showPlayhead(tries + 1);
      });
      return;
    }
    const box = line.getBoundingClientRect();
    const pane = view.scrollDOM.getBoundingClientRect();
    // The sounding system whole on the pane: the page is left alone. This is
    // what keeps a score that fits the pane from being scrolled at all, and a
    // scrub within one system from sliding the page under every move.
    if (box.top >= pane.top - REVEAL_SLACK && box.bottom <= pane.bottom + REVEAL_SLACK) {
      return;
    }
    view.scrollDOM.scrollTop +=
      (box.top + box.bottom) / 2 - (pane.top + pane.bottom) / 2;
  }

  // ---- Following a sounding tune ----

  // Called every frame from the cursor loop with where the head stands, or
  // with null when there is no engraving on screen to read a place off. What
  // the place says no longer decides anything: showPlayhead measures the band
  // for itself and does nothing while it shows whole, so all this has to do
  // is ask, every frame the music is sounding and there is a score to ask
  // about. The system the music was last seen on used to be kept here, since
  // the page moved at the crossing and nowhere else; nothing reads it now.
  function followPlayhead(place) {
    // A hand on the progress bar is a seek, and a seek reveals itself from
    // the drag handlers. Paused or stopped, the reader has the page.
    if (cursorDrag !== null || !isSounding(player.bar)) return;
    // No engraving to read a place off: the tune is still priming, or the
    // reader has taken the page far enough away that CodeMirror keeps no
    // widget for the block. Neither is followed. The first is a wait of a
    // frame or two; the second is a reader who has left the score behind, and
    // hauling the page back to a block they have scrolled a page past is the
    // one thing this must not do. The tune goes on sounding either way,
    // reachable from the row in the toolbar, and the music is picked up again
    // when the score comes back within the pane's reach.
    if (!place) return;
    revealPlayhead();
  }

  let cursorLoop = 0; // the rAF handle while a player is open

  function cursorFrame() {
    cursorLoop = requestAnimationFrame(cursorFrame);
    if (!player) return;
    const block = playerBlock();
    const code = block && block.querySelector("code.language-abc");
    const svg = code && code.querySelector("svg");
    if (!svg) {
      // Scrolled out: nothing to draw the line on, and no system to read a
      // place from. The follow still hears about it, so that a stop made from
      // up here is not carried over into the next tune as a crossing.
      followPlayhead(null);
      return;
    }
    const line = svg.querySelector(".mdm-play-cursor");
    const timer = player.controller && player.controller.timer;
    const total = (timer && timer.lastMoment) || 0;
    let ms = timer && timer.currentMillisecond();
    if (typeof ms !== "number" || !isFinite(ms)) ms = 0;
    // Shown while the tune runs, and wherever a head stands mid-tune: a
    // pause leaves the line where the music stopped, a seek puts it where
    // the music would begin, played yet or not. Gone past either end, since
    // a stop rewinds the clock to nought and a finished tune parks it on
    // the total, and neither is a place the music is standing. A held head
    // outranks all of that: while a hand is on the progress bar (and until
    // the seek it asked for lands) the line follows the hand, wherever the
    // clock stands and whether there is a clock yet at all.
    const show =
      cursorDrag !== null ||
      (total > 0 &&
        (isSounding(player.bar) ||
          (ms > 0 && ms < total) ||
          (ms === 0 && inkOn())));
    const visual = show && SCORE_VISUALS.get(code);
    const timing = visual && cursorTimings(visual);
    if (!timing) {
      if (line && line.parentNode) line.parentNode.removeChild(line);
      // No cursor to show: a stopped tune, or one still priming, which is
      // where a press of play lands before the first note has a place.
      followPlayhead(null);
      return;
    }
    const at =
      cursorDrag !== null
        ? cursorDrag * timing.total
        : (ms * timing.total) / total;
    const place = cursorPlace(timing, at);
    followPlayhead(place);
    const el = line || cursorEl(svg);
    el.setAttribute("x1", place.x);
    el.setAttribute("x2", place.x);
    el.setAttribute("y1", place.top);
    el.setAttribute("y2", place.bottom);
  }

  function cursorEl(svg) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "mdm-play-cursor");
    // The stroke keeps its screen width while the SVG is scaled to fit.
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(line);
    return line;
  }

  // The loop runs for as long as a player is open, and only then: what it
  // does each frame is a couple of lookups when there is nothing to draw.
  function startCursor() {
    if (!cursorLoop) cursorFrame();
  }

  function stopCursor() {
    if (cursorLoop) cancelAnimationFrame(cursorLoop);
    cursorLoop = 0;
    cursorDrag = null; // a drag cannot outlive the player it was made in
    document.querySelectorAll("#app .mdm-play-cursor").forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  // The score widgets on screen, in document order (ScoreWidget above).
  function scoreBlocks() {
    return Array.prototype.slice.call(
      document.querySelectorAll("#app .mdm-score")
    );
  }

  // The tune a widget was engraved from. The widget is rebuilt from the new
  // source the moment an edit inside the block settles, so this is what the
  // block holds.
  function scoreSource(block) {
    return block.getAttribute("data-mdm-source") || "";
  }

  // Where a score widget sits in the document: the end of its block, which
  // is the position CodeMirror hangs the widget on.
  function blockPos(block) {
    return view ? view.posAtDOM(block) : -1;
  }

  // The block the player is open on. The bar sits in the toolbar and says
  // nothing about which score is sounding, so the block is the widget at the
  // position the player remembers, kept mapped through every edit (see the
  // update listener). Null while the block is out of CodeMirror's viewport,
  // where there is no widget at all: the tune plays on and nothing is drawn
  // on a score that is not on screen.
  //
  // The block found is kept, because this is asked on the hot path: the
  // cursor loop asks once a frame and the ink asks on every note, and each
  // miss is a query over every score in the document plus a position
  // resolution per score. What is kept is trusted only while the element is
  // still in the document at the position it was found at, which is what
  // CodeMirror rebuilding the widget breaks. A miss is not cached: with the
  // score out of the viewport there is nothing to keep, so the scan is done
  // again every frame. That is a query over the scores CodeMirror has
  // rendered, which is at most the handful on screen, and caching the
  // absence would mean deciding when it stops being true.
  function playerBlock() {
    if (!player) return null;
    const held = player.block;
    if (held && document.contains(held) && blockPos(held) === player.pos) {
      return held;
    }
    const blocks = scoreBlocks();
    for (let i = 0; i < blocks.length; i++) {
      if (blockPos(blocks[i]) === player.pos) {
        player.block = blocks[i];
        return blocks[i];
      }
    }
    player.block = null;
    return null;
  }

  // ---- The room the bar takes in the toolbar ----
  //
  // The bar is a row of the toolbar, and the toolbar is a flex item above the
  // editor: growing a row takes its height off the top of the pane, and the
  // text moves down with it. That is what chrome does, and it is left to
  // happen. It was held still once, by nudging the scroller by whatever the
  // toolbar had gained, so that the score whose headphones were just pressed
  // did not slide out from under the pointer. What that bought in stillness
  // it paid for in text: the row does not conjure its 34 pixels, and holding
  // the page put them on the reader's account, so the row came down over the
  // line and a half that had been at the top of the pane and the paragraph
  // there was left cut in half under it. Measured on example.mdm at a pane
  // 640 tall, scrolled to 120: opening the player moved the scroller to 155
  // and the top line went from `lang: en` to `  html:`, two lines the reader
  // had been looking at gone behind the bar. Letting the text move keeps
  // every one of them: the pane shows the same document from the same
  // character on, 34 pixels lower and 34 pixels shorter, and closing the
  // player hands them back.

  function closePlayer() {
    if (!player) return;
    clearResumeHold();
    try {
      clearPlayingHighlight(); // while `player` still says which score
    } catch (e) {
      // a score already re-engraved without the old elements
    }
    stopCursor();
    const p = player;
    player = null;
    if (p.controller) {
      try {
        p.controller.destroy(); // stops the timer and the sounding notes
      } catch (e) {
        // a synth that never finished initializing
      }
    }
    // The bar may be holding the focus (see openPlayer); with it gone the
    // keyboard would land on nothing, so the focus goes back to whoever the
    // bar took it from. To the text when the document was somebody's, which
    // is the caret it was left at; to nobody when it was nobody's, since
    // handing the text a focus it never had would put a caret at the first
    // character of the file, and the block there would come up as source
    // (somebodyInside says the same thing from the other side).
    const hadFocus = p.bar && p.bar.contains(document.activeElement);
    if (p.bar && p.bar.parentElement) p.bar.parentElement.removeChild(p.bar);
    if (hadFocus && view && view.state.field(focusField, false)) view.focus();
    document.querySelectorAll("#app [data-mdm-audio]").forEach(function (el) {
      el.removeAttribute("data-mdm-audio");
    });
    syncToggleLabels();
    restAudioWhenIdle();
  }

  // The bar opens in the toolbar, as a row of its own under the buttons, and
  // not under the score it plays. A score can be a page long (the duet is),
  // and a bar at the foot of it meant scrolling to the bottom to press play
  // and back up to read what was sounding. Up there it is in view whatever
  // the reader is looking at, it is as wide as the pane, so the progress is
  // worth scrubbing, and it takes the width it is given rather than the width
  // of whichever score happens to be playing.
  //
  // What is left behind on the block is data-mdm-audio, which lights the disc
  // under its headphones (style.css), so the lit headphones beside the score
  // say which score the bar belongs to and close it from there.
  function openPlayer(block) {
    closePlayer();
    const code = block.querySelector("code.language-abc");
    if (!code) return;
    // First thing, inside the click: the output starts waking now, and the
    // engine that loads afterwards finds the context made.
    ensureAudioGraph();
    const bar = document.createElement("div");
    bar.className = "mdm-audio";
    // Focusable, though never in the tab order: the headphones hand it the
    // focus as they open it (handleChromeClick), and holding the focus is
    // what puts Space on play/pause (playerTakesSpace) without ever taking
    // the key from the document, where a space is a space.
    bar.setAttribute("tabindex", "-1");
    // Five controls that used to say what they belonged to by sitting under a
    // score, and now sit among the document's formatting buttons: tabbed
    // through, they came as a bare "Play / Stop / Repeat / Position / Volume"
    // in the middle of the toolbar. The group and its name are what the lit
    // disc says to everybody else.
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Player");
    // The focus watchers of the editor are on view.dom, and the bar is no
    // longer inside it: without a pair of its own, the focus LEAVING the bar
    // is seen by nobody, and the document stays somebody's for good. Measured
    // before this was added: with a player open, a click on the bare strip of
    // the toolbar left the heading marks showing and the caret drawn with
    // nothing in the page focused, where the same click with no player open
    // puts the document into visual mode. It is also what makes
    // leaveDocument's blur of the bar mean anything. They go with the
    // element, so closing the player takes them off.
    bar.addEventListener("focusin", syncFocus);
    bar.addEventListener("focusout", function () {
      // On the way out the focus has not landed yet, the same as on view.dom.
      setTimeout(syncFocus, 0);
    });
    // The focus watchers of the editor are on view.dom, and the bar is no
    // longer inside it: without a pair of its own, the focus LEAVING the bar
    // is seen by nobody, and the document stays somebody's for good. Measured
    // before this was added: with a player open, a click on the bare strip of
    // the toolbar left the heading marks showing and the caret drawn with
    // nothing in the page focused, where the same click with no player open
    // puts the document into visual mode. It is also what makes
    // leaveDocument's blur of the bar mean anything. They go with the
    // element, so closing the player takes them off.
    // Nothing of the bar's is stopped on its way up any more. It used to stop
    // click, mousedown, mouseup, input and change, to keep the document's own
    // listeners out of a bar that sat inside the text; in the toolbar the
    // only listener any of them could still reach is the menu closer
    // (buildToolbar), which now SHOULD hear them: a drop-down left open hangs
    // directly over this row, and a press on the player has to put it away
    // like a press anywhere else. Everything else that listens for those
    // types does so in the capture phase, where a bubble-phase stop never had
    // any say (dismissFromOutside, dismissTip, pressedAt, watchAltPresses).
    //
    // The keys were never on that list and still must not be. A key pressed
    // with the bar focused has to go on rising to the window, because that is
    // where the webview preload picks it up and hands it to the workbench
    // (handleInnerKeydown, in workbench/contrib/webview/browser/pre/
    // index.html): stopped here, Ctrl+S never reached VS Code and the file
    // would not save while the bar held the focus, and no other shortcut of
    // the workbench worked either. What keeps those keys off the text is no
    // longer CodeMirror's own eventBelongsToEditor (the bar used to sit in a
    // ScoreWidget, whose ignoreEvent said to drop them) but the plainer fact
    // that the bar is not in the editor at all. Measured with the bar
    // focused: Backspace, Delete, Enter, a letter, ArrowDown and Ctrl+B all
    // leave the document byte for byte as it was.
    //
    // The caret stays where it is while the player is used. A <button> is
    // focusable, so its mousedown would pull the focus out of the editor, and
    // unlike the toolbar's own buttons the bar has no view.focus() to put it
    // back with: the bar is where the keyboard is meant to stay. Preventing
    // the default of mousedown keeps the focus where it is (and the click,
    // which fires regardless), so the document stays somebody's and whatever
    // block was open stays open. Two controls keep theirs: the volume slider,
    // a form control that needs the browser's own drag, and the progress bar,
    // which answers the arrow keys once it has been clicked just as the
    // volume does. Neither takes a text selection with it (the two carry
    // user-select: none), and somebodyInside reads a focus resting on either
    // as the document's own.
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
    // Last child of the toolbar, so it takes a line below every line of
    // buttons (the toolbar wraps, and the row asks for the whole of one), and
    // so the buttons keep the document order the toolbar tests read them in.
    // No width is set here: the row is as wide as the toolbar, and follows it
    // when the pane is dragged (style.css, and watchPlayerWidth for the head
    // abcjs places in pixels).
    const toolbar = document.querySelector("#app .mdm-toolbar");
    if (toolbar) toolbar.appendChild(bar);
    block.setAttribute("data-mdm-audio", "1"); // lights the disc of its headphones
    player = {
      pos: blockPos(block),
      block: block,
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
          bar.textContent = "The score has nothing to play.";
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
                // A hand holding the progress head has put the ink out
                // (makeProgressDraggable) and muted the output, while the
                // transport runs on underneath: the notes passing under the
                // old position sound nothing and must light nothing.
                if (cursorDrag !== null) return;
                // Inside a resume gap the sound is muted and this event is the
                // one the timer reported early: abcjs advances its pointer the
                // moment it is told to move, so what it hands over is the note
                // AFTER the head. It waits for the moment it is really due,
                // which is its own on the tune clock; what the gap itself is
                // waiting for was put on that clock when the gap was
                // scheduled. The two are the same note whenever the gap ends
                // on the next note, and different under an ornament, where it
                // ends on the note the head is already inside.
                if (inkHeld()) {
                  paintInkAt(
                    ev,
                    typeof ev.milliseconds === "number" ? ev.milliseconds : inkEndsAt
                  );
                  return;
                }
                highlightPlaying(ev);
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
        // A seek is a scrub, and a scrub lands inside a note as often as not.
        // Left alone the engine would start the sound on that note's tail with
        // no attack, an echo of the chord that was going, and paint the ink on
        // the note AFTER the head, its event pointer having moved on the
        // moment it was told to seek. Both are what a resume from a pause used
        // to do, and both are answered the same way (scheduleSilentGap): the
        // remainder of the note under the head passes in silence and the note
        // that is due lands on its beat, in ink and in sound together.
        //
        // The silence is scheduled BEFORE the engine is told to move, since
        // the event it reports comes back from inside that call and the ink
        // hold has to be in force to catch it. Outside a gap (nothing
        // sounding, or a head dropped on an attack) the ink is placed here
        // instead, over the note the engine just marked one too far along.
        const controllerSeek = controller.seek;
        controller.seek = function (percent) {
          const timer = controller.timer;
          const total = (timer && timer.lastMoment) || 0;
          const at =
            typeof percent === "number" && total > 0 ? percent * total : null;
          if (at === null) return controllerSeek.apply(controller, arguments);
          if (isSounding(bar)) scheduleSilentGap(timer, at);
          else clearResumeHold();
          const out = controllerSeek.apply(controller, arguments);
          // Outside a gap the ink is ours to place, over the note the engine
          // just marked one too far along: the note the head is on when it is
          // on an attack, and none at all when it is inside a note, where what
          // comes next is the silence.
          if (!inkHeld()) markNoteAt(timer, at);
          return out;
        };
        player.controller = controller;
        startCursor();
      })
      .catch(function () {
        if (player && player.bar === bar) {
          bar.textContent = "The synthesizer could not be loaded.";
        }
      });
  }

  // After every change of the content DOM: the bar is carried over widget
  // rebuilds. An edit inside the open block replaces its widget and the bar
  // with it; the player reopens on the block in the same position, with the
  // current source, stopped. A tune edited under a sounding player should not
  // keep playing the old notes. A caret going in and out of the block does
  // not rebuild the widget (ScoreWidget keeps its element through updateDOM
  // while the source is the same), so a player plays on while its source is
  // open beside it.
  function syncPlayer() {
    if (player) {
      const block = playerBlock();
      if (!block) {
        // Scrolled out of the viewport, where CodeMirror keeps no widget:
        // the tune plays on, and the bar waits for the block to come back.
        // Gone for good (the block deleted) is told apart by the text: no
        // score source at the remembered position.
        if (!scoreAt(player.pos)) closePlayer();
      } else if (scoreSource(block) !== player.source) {
        openPlayer(block);
      } else {
        // The widget may have been built again (back into view, or a caret
        // went in and out). The bar stays where it is, in the toolbar, with
        // its controller and whatever is sounding; what the new widget needs
        // is the mark that lights its headphones.
        block.setAttribute("data-mdm-audio", "1");
      }
    }
    syncToggleLabels();
  }

  // Whether a ```abc block still ends at this document position.
  function scoreAt(pos) {
    if (!view || pos < 0 || pos > view.state.doc.length) return false;
    const tree = CM.syntaxTree(view.state);
    let node = tree.resolveInner(Math.max(0, pos - 1), -1);
    while (node && node.name !== "FencedCode") node = node.parent;
    if (!node) return false;
    const info = node.getChild("CodeInfo");
    return !!info && isAbcInfo(view.state.sliceDoc(info.from, info.to)) && view.state.doc.lineAt(node.to).to === pos;
  }

  // The face of the toggle, drawn like the toolbar icons: fill only.
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
  const HEADPHONES_SHAPES =
    '<path d="M1.6 10.6a6.4 6.4 0 0 1 12.8 0h-1.3a5.1 5.1 0 0 0-10.2 0Z"/>' +
    '<rect x="1.1" y="9.9" width="3" height="4.6" rx="1.3"/>' +
    '<rect x="11.9" y="9.9" width="3" height="4.6" rx="1.3"/>';
  const HEADPHONES_ICON =
    '<svg viewBox="0 0 16 16">' + HEADPHONES_SHAPES + "</svg>";
  // The same drawing for the bar's own copy of the toggle, inside a <g>: the
  // rules that colour the bar's buttons reach for one, the way abcjs draws
  // its own (see STOP_ICON).
  const HEADPHONES_BAR_ICON =
    '<svg viewBox="0 0 16 16"><g>' + HEADPHONES_SHAPES + "</g></svg>";

  // Tooltips name the destination of the click, as everywhere in this editor.
  // The drawing does not: there is only one of it (see HEADPHONES_ICON), and
  // what says whether this block's player is open is the lit disc the
  // stylesheet draws from data-mdm-audio.
  function syncToggleLabels() {
    const open = player ? playerBlock() : null;
    scoreBlocks().forEach(function (block) {
      const span = block.querySelector(".mdm-audio-toggle");
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

  // ---- The keyboard ----

  // With a player open, Space is its play and its pause, the way it is in
  // any other player. Only where a space is not text: this is a text editor
  // first and a space typed into the document has to stay a space, so the
  // key is taken only while the focus is out of the editor's content. That
  // is where the headphones leave it (opening a player focuses its bar, and
  // the caret gone from the text is what says the keyboard is on the
  // player); clicking back into the document hands Space back to the text.
  // Never from a control that answers a press of its own either: the
  // toolbar's buttons and menu rows, the volume slider, and the bar's own
  // play, stop and repeat, which a Tab can reach.
  const SELF_KEYED = "button, input, select, textarea, a[href]";

  function playerTakesSpace(e) {
    if (!player || !player.bar) return false;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    if (e.repeat) return false; // held down is one press, not a stutter
    // The bar is asked first and by name, so the answer does not turn on
    // where in the page the bar happens to sit: a focus resting on it is the
    // player's, whatever else is true.
    const at = document.activeElement;
    if (!at || !at.matches) return false;
    if (player.bar.contains(at)) return !at.matches(SELF_KEYED);
    // Elsewhere the rule is the one it has always been, read off the element
    // that holds the focus and never off what it hangs from: a caret in the
    // text keeps Space for the text, and a control that answers a press of
    // its own keeps it too (the toolbar's buttons and menu rows).
    if (at.isContentEditable) return false; // a caret in the text
    return !at.matches(SELF_KEYED); // a control answers its own press
  }

  // Through the widget's own play button rather than the controller, the way
  // the stop button does it: the face of the button, its label and the
  // resume in silence (watchPlayPresses) then follow a press of the key
  // exactly as they follow a press of the mouse.
  function togglePlayback() {
    const start =
      player && player.bar && player.bar.querySelector(".abcjs-midi-start");
    if (!start) return; // a bar whose synth has not mounted yet
    wakeAudio(); // a press is a gesture, and the output wakes on it
    start.click();
  }

  // Capture at the document, so this is heard before anything the page does
  // with the key: the toolbar closes its menus on Escape from the bubble
  // (buildToolbar), and Escape from the bar has to hand the keyboard back
  // first. Neither press can want both, since opening a menu takes the focus
  // off the bar.
  function watchPlayerKeys() {
    document.addEventListener(
      "keydown",
      function (e) {
        if ((e.key === " " || e.key === "Spacebar") && playerTakesSpace(e)) {
          e.preventDefault(); // and never the page's scroll
          togglePlayback();
          return;
        }
        // The way back to the text: while the bar holds the focus nothing
        // else answers the keyboard, so Escape hands it to the document.
        if (
          e.key === "Escape" &&
          view &&
          player &&
          player.bar &&
          player.bar.contains(document.activeElement)
        ) {
          view.focus();
        }
      },
      true
    );
  }

  // Starting anywhere but on a note's attack keeps the beat. A pause cuts a
  // note short, and so does a head dropped mid-chord; starting from there must
  // not replay the note's tail with no attack (abcjs's own resume, which
  // sounds like an echo of the chord that was going), must not jump ahead to
  // the next note (this editor's first attempt, which near a barline could
  // land a full measure late, since the visual clock runs a touch apart from
  // the sound), and must not paint ink before its sound (abcjs advances its
  // event pointer the moment it is told to move or to restart, so the note it
  // reports is the NEXT one). What it does instead is what a count-in does:
  // the sound picks up exactly where the head is but MUTED, the remainder of
  // the cut note passes in true silence with the clock running, and the gain
  // comes back a hair before the next note attacks, on the audio context's own
  // clock, so the note that is due lands on its beat in ink and in sound
  // together.
  //
  // One rule covers the two gestures, since both are read off the tune clock
  // alone: a press of play, wherever the tune stands, and a seek while it is
  // sounding. On an attack (the top of the tune included) there is nothing to
  // wait out and the sound comes at once.
  let inkHoldUntil = 0; // wall clock; the end of the gap the ink waits out
  let inkEndsAt = 0; // the same moment, on the tune clock
  let inkClockZero = 0; // the wall-clock moment the tune clock read zero
  let inkTimers = []; // paints put off until the moment they are due

  // Whether a gap is running, which is what says the ink is spoken for.
  function inkHeld() {
    return inkHoldUntil > performance.now();
  }

  // A stretch of source lit at the moment the tune clock reaches `ms`, and at
  // once when that moment has gone by. A sounding note waits for the end of
  // the gap however early its moment falls, since what the ink says and what
  // is coming out have to agree. A written silence agrees with the gap
  // already: it sounds nothing whether the gain is up or down, so it is lit on
  // its own beat, which is the only beat it has. Held back with the notes, a
  // rest inside the gap was painted after its own moment had gone by, and the
  // cursor walked over it in ink.
  function paintInkAt(note, ms) {
    const sounds = !!(note && note.midiPitches && note.midiPitches.length);
    const due = sounds ? Math.max(ms, inkEndsAt) : ms;
    const wait = inkClockZero + due - performance.now();
    if (wait <= 0) {
      highlightPlaying(note);
      return;
    }
    inkTimers.push(
      setTimeout(function () {
        if (player) highlightPlaying(note);
      }, wait)
    );
  }

  function clearResumeHold() {
    inkHoldUntil = 0;
    inkEndsAt = 0;
    inkTimers.forEach(clearTimeout);
    inkTimers = [];
    if (audioMute && audioCtx) {
      try {
        audioMute.gain.cancelScheduledValues(0);
        audioMute.gain.setValueAtTime(1, audioCtx.currentTime);
      } catch (e) {
        // a context torn down mid-flight
      }
    }
  }

  // Whether the tune is running. The play button wears abcjs-pushed while it
  // is, which is also how the press handler below tells a pause from a play.
  function isSounding(bar) {
    const start = bar && bar.querySelector(".abcjs-midi-start");
    return !!start && start.classList.contains("abcjs-pushed");
  }

  // Capture phase on the bar: runs before the handler abcjs put on the play
  // button, observes, and never swallows the click.
  function watchPlayPresses(e) {
    const button = e.target.closest && e.target.closest(".abcjs-midi-start");
    if (!button || !player || !player.controller) return;
    const timer = player.controller.timer;
    if (!timer || typeof timer.currentMillisecond !== "function") return;
    if (button.classList.contains("abcjs-pushed")) return; // this press pauses
    // Play from wherever the tune stands. From the top, or from a note's
    // attack, that is at once; from inside a note (a pause, or a head dropped
    // mid-chord) the remainder of that note passes in silence first.
    scheduleSilentGap(timer, timer.currentMillisecond());
  }

  // Milliseconds to the whole note, at the moment a timing sits on. The timer
  // works in milliseconds while abcjs gives the length of a grace note in whole
  // notes (midiGraceNotePitches calls the field durationInMeasures, but a
  // measure is not what it counts: the d of {d}c2 in 3/4 comes back as 0.125,
  // an eighth of a whole note and a sixth of that measure), so an ornament
  // cannot be put on the clock without this. Read off the timing's own measure,
  // so a tempo change is taken where it happens rather than averaged over the
  // tune. Zero when the tune is not there to ask, and the ornament then
  // collapses onto its note, which is where it used to be.
  function msPerWhole(timing) {
    const visual = player && player.controller && player.controller.visualObj;
    const perMeasure = timing && timing.millisecondsPerMeasure;
    if (!visual || !perMeasure) return 0;
    const measure = visual.getBeatLength() * visual.getBeatsPerMeasure();
    return measure > 0 ? perMeasure / measure : 0;
  }

  // Every moment the tune attacks, in order: when a sound begins, and the note
  // group it was written from, which is what the ink is painted from. A bar
  // line or a line end sounds nothing and carries no pitches, so it is no
  // attack.
  //
  // A note under an ornament attacks more than once. abcjs sounds the grace
  // notes at the group's own moment and pushes the note itself back behind
  // them, and the timer keeps the two apart: midiPitches is the note alone,
  // midiGraceNotePitches the ornament. Read as one attack per group, {d}c2
  // would look like a single note beginning where its d does, and a head
  // dropped anywhere inside it would wait the whole group out in silence,
  // ornament and note together.
  function attacks(timer) {
    const timings = (timer && timer.noteTimings) || [];
    const out = [];
    for (let i = 0; i < timings.length; i++) {
      const t = timings[i];
      if (!t || typeof t.milliseconds !== "number") continue;
      if (!t.midiPitches || !t.midiPitches.length) continue;
      const graces = t.midiGraceNotePitches || [];
      const scale = graces.length ? msPerWhole(t) : 0;
      let at = t.milliseconds;
      for (let g = 0; g < graces.length; g++) {
        out.push({ at: at, note: t });
        at += (graces[g].durationInMeasures || 0) * scale;
      }
      out.push({ at: at, note: t });
    }
    return out;
  }

  // What sounds first from a point on the tune clock, and the silence that goes
  // in front of it. One reading, and the two things that follow from a seek or
  // a press of play are read off it, so they cannot disagree:
  //
  //  - on an attack, within a hair of it, what begins there and no silence:
  //    what sounds from that point is its own beginning;
  //  - inside a sound, whatever attacks next behind a silence: the remainder of
  //    the one the point is in passes muted, and the ink waits with it;
  //  - inside a sound but a hair short of the next attack, that attack and no
  //    silence: there is nothing left worth cutting;
  //  - inside the last sound, nothing and a silence to the end: nothing will
  //    attack again, so the tail stays quiet rather than sounding with no
  //    beginning;
  //  - before the first attack, nothing at all.
  //
  // Attacks and not notes throughout, since an ornamented note holds several
  // (see attacks): the c of a {d}c2 is due on its own beat, and a head dropped
  // on the d must not take it down with the ornament.
  //
  // The wait is set a few ms short so that a clock skew clips a sliver of
  // silence and never the attack that is due.
  const ATTACK_SLACK = 25;
  function soundFrom(timer, at) {
    const list = attacks(timer);
    let here = null;
    let after = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].at > at + 1) {
        after = list[i];
        break;
      }
      here = list[i];
    }
    if (!here) return null;
    if (at - here.at <= ATTACK_SLACK) return { note: here.note, wait: 0 };
    const next = after ? after.at : timer.lastMoment || 0;
    const wait = (next - at - ATTACK_SLACK) / 1000;
    return { note: after ? after.note : null, wait: wait <= 0.03 ? 0 : wait };
  }

  // The written silence a moment of the clock falls in, and nothing when it
  // falls in a sound. soundFrom cannot answer this: a rest attacks nothing, so
  // it is not in the walk attacks() makes, and the stretch of tune it holds
  // reads there as the tail of the note before it. What the score shows at
  // that moment is the rest, and so is what comes out of the speakers, so the
  // ink reads the same timings for itself.
  //
  // A moment where nothing at all attacks, and only that: a rest one voice
  // holds while another plays belongs to an event that sounds, and soundFrom
  // names it, with the rest in the same group and lit with it.
  function restAt(timer, at) {
    const timings = (timer && timer.noteTimings) || [];
    let here = null;
    for (let i = 0; i < timings.length; i++) {
      const t = timings[i];
      if (!t || t.type !== "event") continue;
      if (typeof t.milliseconds !== "number") continue;
      // A measure that begins with nothing attacking gets a placeholder that
      // names no source; it is no more the ink's than the walker's.
      if (typeof t.startChar !== "number") continue;
      if (t.milliseconds > at + 1) break;
      here = t;
    }
    return here && !(here.midiPitches && here.midiPitches.length) ? here : null;
  }

  // The ink under the head, once the head has been moved: the note that sounds
  // from there, the rest the head landed inside when it landed in one, and
  // none at all when what comes first is the silence of a note cut short.
  function markNoteAt(timer, at) {
    const from = soundFrom(timer, at);
    if (from && !from.wait && from.note) {
      highlightPlaying(from.note);
      return;
    }
    const rest = restAt(timer, at);
    if (rest) highlightPlaying(rest);
    else clearPlayingHighlight();
  }

  function scheduleSilentGap(timer, at) {
    clearResumeHold();
    if (!audioMute || !audioCtx) return;
    const from = soundFrom(timer, at);
    if (!from || !from.wait) return; // an attack, or nothing worth cutting
    const remaining = from.wait;
    try {
      const now = audioCtx.currentTime;
      audioMute.gain.cancelScheduledValues(now);
      audioMute.gain.setValueAtTime(0, now);
      audioMute.gain.setValueAtTime(1, now + remaining);
    } catch (e) {
      // The two calls are one gesture and the second is the one that can
      // refuse its value; a silence taken and never given back is a player
      // that stays quiet for the rest of the session, so the gain goes back
      // up whatever went wrong. No silence is better than no sound.
      clearResumeHold();
      return;
    }
    // The ink falls silent with the sound: the cut note goes back to ink, and
    // what is due when the gain comes back is lit then and not before. That is
    // read off the same soundFrom the silence was, so the ink cannot name a
    // note other than the one that sounds.
    clearPlayingHighlight();
    inkClockZero = performance.now() - at;
    inkEndsAt = at + remaining * 1000;
    inkHoldUntil = performance.now() + remaining * 1000;
    // Unless the head landed inside a written silence, which the gap is not
    // muting: that rest is lit at once, since its own event went by before the
    // head arrived and nothing will report it again. The rests the gap runs
    // over after this one are lit by their events, on their own beat.
    const rest = restAt(timer, at);
    if (rest) highlightPlaying(rest);
    if (from.note) paintInkAt(from.note, inkEndsAt);
  }

  // ---- Exporting a score's audio ----
  //
  // What lands on disk is what the reader hears: the same tune, sounded with
  // the same options the player mounts it with (MDM_AUDIO.synthOptions), and
  // for a WAV the same rendering, one AudioBuffer primed note by note faster
  // than real time. The bytes go to the host, which writes them beside the
  // document; nothing here reaches the file system, and none of it needs
  // Quarto, TeX or Chrome.
  //
  // MIDI and WAV are what the editor can write on its own. MP3 is put off: no
  // browser encodes it, so it would mean either vendoring an encoder (LGPL,
  // and the webview's CSP has no worker-src to run it off the main thread) or
  // leaning on ffmpeg being installed, which nothing the reader can reach
  // without an export is allowed to need.
  const AUDIO_FORMATS = [
    { to: "midi", label: "MIDI" },
    { to: "wav", label: "WAV" },
  ];

  // How long a file may wait for the host to say it was written. The host
  // answers each file before the next score is rendered, so this is only ever
  // reached when a message is lost, and a run that hangs would hold the audio
  // output and the host's lock for as long as the editor is open.
  const AUDIO_ACK_MS = 60000;

  // Exports in flight, which the output's idle rules read (restAudioWhenIdle,
  // visibilitychange above): a suspended context never returns from the
  // resume() prime() waits on.
  let audioExports = 0;
  // The runs this editor has open, by the id the host answers them with. There
  // is normally one: the host turns away a second export of the same document
  // and the run ends on its own answer. Keyed all the same, because the run
  // that is answered second is not necessarily the run that was asked second,
  // and a run whose answers went to another would wait out its own timeout.
  const audioRuns = new Map();
  let audioRunSeq = 0;

  // Every score of the document, in the order they are written in, numbered
  // from one. Read off the syntax tree and not off the widgets on screen:
  // CodeMirror builds a widget for the viewport alone, and the numbering has
  // to be the same whichever button asked for it, so a score below the fold
  // counts. ensureSyntaxTree parses whatever has not been parsed yet and
  // answers null if it could not reach the end inside the budget, which is the
  // one case where the count would be short. Two seconds is the most the
  // editor may stand still for a press: that is the parser running on this
  // thread. A document it cannot read in that time is one the reader is asked
  // to press again for, by which time the parse that goes on in the background
  // has covered more of it.
  //
  // What the host calls a score is a little wider than this: hasScores in
  // extension.js takes `.abc` anywhere in a brace, while the editor draws one
  // only where the class comes first (isAbcInfo). The numbering follows the
  // editor, since it is the editor's scores the reader is looking at.
  function documentScores(state) {
    const tree = CM.ensureSyntaxTree(state, state.doc.length, 2000);
    if (!tree) return null;
    const doc = state.doc;
    const out = [];
    tree.iterate({
      enter: function (ref) {
        if (ref.name !== "FencedCode") return;
        const node = ref.node;
        const info = node.getChild("CodeInfo");
        if (!isAbcInfo(info ? doc.sliceString(info.from, info.to) : "")) return false;
        out.push({
          number: out.length + 1,
          end: scoreEnd(doc, node, ref.to),
          source: fenceSource(doc, node),
        });
        return false;
      },
    });
    return out;
  }

  // Whether the document has no score in it at all, which is what greys the
  // Audio rows of the export menu. The tree that is already there answers it
  // for every document with a score on screen, and only one with none in
  // sight is worth waiting on the parser for; 100 ms rather than the two
  // seconds the export itself allows, because this runs on the press that
  // opens a panel and not on the press that writes the files.
  //
  // An answer that cannot be reached in that time is "it has one", so the
  // rows stay live: a row that cannot be pressed and does not say why is
  // worse than a press the host answers by naming what a score is.
  function scoreless(state) {
    if (!state) return false;
    if (anyScore(CM.syntaxTree(state), state.doc)) return false;
    const tree = CM.ensureSyntaxTree(state, state.doc.length, 100);
    return tree ? !anyScore(tree, state.doc) : false;
  }

  function anyScore(tree, doc) {
    let seen = false;
    tree.iterate({
      enter: function (ref) {
        if (seen) return false;
        if (ref.name !== "FencedCode") return;
        const info = ref.node.getChild("CodeInfo");
        if (isAbcInfo(info ? doc.sliceString(info.from, info.to) : "")) seen = true;
        return false;
      },
    });
    return seen;
  }

  // The number of the score a rail button belongs to: the widget hangs on the
  // end of its block, which is the position documentScores reports, and that
  // holds for two scores written from the same source.
  function scoreNumber(block) {
    const scores = view ? documentScores(view.state) : null;
    if (!scores) return 0;
    const pos = blockPos(block);
    const hit = scores.filter(function (score) {
      return score.end === pos;
    })[0];
    return hit ? hit.number : 0;
  }

  // The bytes of one score, or why it has none. The tune is parsed and not
  // engraved: what the synth reads is the tune data, and an engraving is a
  // drawing of it that a hidden panel cannot measure anyway.
  function scoreAudio(A, source, format) {
    try {
      return scoreBytes(A, source, format);
    } catch (e) {
      // Everything up to the synth is synchronous (the parse, the flattening,
      // the MIDI), so a tune abcjs cannot read would otherwise throw out of
      // the run and take the scores after it with it.
      return Promise.resolve({ reason: "failed", detail: String((e && e.message) || e) });
    }
  }

  function scoreBytes(A, source, format) {
    const options = MDM_AUDIO.synthOptions(window.MDM_SOUNDFONT);
    const tune = (A.parseOnly(source) || [])[0];
    if (!tune) return Promise.resolve({ reason: "empty" });
    const title = (tune.metaText && tune.metaText.title) || null;
    const flattened = tune.setUpAudio(options);
    // Nothing to play is not the same as nothing to last: a bar of rests has
    // a duration and no note, and a silent file would be a poor answer.
    if (!MDM_AUDIO.noteCount(flattened)) {
      return Promise.resolve({ title: title, reason: "empty" });
    }
    if (format === "midi") {
      return Promise.resolve({ title: title, bytes: MDM_AUDIO.midiBytes(A, tune, options) });
    }
    if (!A.synth || !A.synth.supportsAudio()) {
      return Promise.resolve({ title: title, reason: "unsupported" });
    }
    // Asked before a note is fetched: a sample the extension does not carry
    // leaves a rejected promise in abcjs's cache and prime() then throws it
    // with the raw URL in the message, which says nothing to a musician.
    const missing = MDM_AUDIO.unplayable(A, flattened);
    if (missing.length) {
      return Promise.resolve(Object.assign({ title: title }, missing[0]));
    }
    const synth = new A.synth.CreateSynth();
    return synth
      .init({
        visualObj: tune,
        options: options,
        // What SynthController.go hands the synth, and what the tune is drawn
        // and played at here. Left out, abcjs falls back to 180 of the tune's
        // own beats, which is a compound meter's 6/8 sounded half again as
        // fast as the player sounds it (measured).
        millisecondsPerMeasure: tune.millisecondsPerMeasure(),
      })
      .then(function () {
        return synth.prime();
      })
      .then(function () {
        const buffer = synth.getAudioBuffer();
        if (!buffer || !buffer.length) return { title: title, reason: "empty" };
        const channels = [];
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          channels.push(buffer.getChannelData(channel));
        }
        const bytes = MDM_AUDIO.wavBytes(channels, buffer.sampleRate);
        // The buffers are the biggest thing in the page (a three-minute tune
        // is about 30MB of samples), and the run holds the next score right
        // after this one.
        synth.audioBuffers = [];
        return { title: title, bytes: bytes };
      })
      .catch(function (e) {
        return { title: title, reason: "failed", detail: String((e && e.message) || e) };
      });
  }

  // A run is a conversation with the host, one score at a time: `start` says
  // how many files to expect and is answered before a note is rendered, each
  // file or skip is acknowledged before the next score is begun, so nothing
  // is rendered for a host that is not writing it, and `done` always follows,
  // from a finally, so a throw here cannot leave the host's progress
  // notification up and its lock held.
  function audioReply(run, message) {
    return new Promise(function (resolve) {
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        run.waiting = null;
        resolve({ ok: false });
      }, AUDIO_ACK_MS);
      run.waiting = function (reply) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(reply);
      };
      vscode.postMessage(message);
    });
  }

  function exportAudio(format, number) {
    const known = AUDIO_FORMATS.some(function (entry) {
      return entry.to === format;
    });
    if (!view || !known) return Promise.resolve();
    const A = window.ABCJS;
    if (!A) return Promise.resolve();
    // Inside the click, before anything is awaited: a context made and
    // resumed under a gesture is allowed to run whatever the autoplay policy
    // says, and prime() ends by waiting on that resume. A MIDI touches none
    // of this, and a MIDI export therefore opens no output at all.
    if (format === "wav") {
      makeAudioGraph();
      if (A.synth) registerAudioGraph(A);
      if (audioCtx && audioCtx.state !== "running") {
        try {
          audioCtx.resume();
        } catch (e) {
          // a context the browser has already taken away
        }
      }
    }
    const scores = documentScores(view.state);
    const chosen = !scores
      ? []
      : number
      ? scores.filter(function (score) {
          return score.number === number;
        })
      : scores;
    audioRunSeq++;
    const run = { id: "r" + audioRunSeq, waiting: null, cancelled: false };
    audioRuns.set(run.id, run);
    audioExports++;
    const skipped = [];
    return audioReply(run, {
      type: "exportAudio",
      step: "start",
      id: run.id,
      format: format,
      count: scores ? scores.length : 0,
      total: chosen.length,
      // The tree could not be read to the end in the time it was given, so
      // the count above is not the document's and the host says so rather
      // than writing a part of it.
      unread: !scores,
    }).then(function (reply) {
      if (!reply || !reply.ok) return null;
      // One score at a time, each one after a turn of the event loop so that
      // the editor answers the keyboard between them. setTimeout and not
      // requestAnimationFrame: a hidden panel runs no frames, and a reader
      // who changes tab mid-export would leave the run standing there.
      return chosen.reduce(function (queue, score) {
        return queue.then(function () {
          if (run.cancelled) return null;
          return new Promise(function (resolve) {
            setTimeout(resolve, 0);
          })
            .then(function () {
              return scoreAudio(A, score.source, format);
            })
            .then(function (made) {
              if (run.cancelled) return null;
              if (!made.bytes) {
                skipped.push(Object.assign({ number: score.number }, made));
                return audioReply(run, {
                  type: "exportAudio",
                  step: "skip",
                  id: run.id,
                  number: score.number,
                  title: made.title || null,
                  reason: made.reason,
                  program: made.program,
                  pitch: made.pitch,
                  detail: made.detail,
                });
              }
              return audioReply(run, {
                type: "exportAudio",
                step: "file",
                id: run.id,
                number: score.number,
                title: made.title || null,
                bytes: made.bytes,
              }).then(function (ack) {
                // A host that could not write this one will not write the
                // next either: it has said what is wrong and the run ends.
                if (ack && ack.ok === false) run.cancelled = true;
                return ack;
              });
            });
        });
      }, Promise.resolve());
    })
      .catch(function (e) {
        run.failed = String((e && e.message) || e);
      })
      .then(function () {
        vscode.postMessage({
          type: "exportAudio",
          step: "done",
          id: run.id,
          aborted: !!(run.cancelled || run.failed),
        });
        audioRuns.delete(run.id);
        audioExports--;
        // The output goes back to the rules it lives by, rather than being
        // rested here come what may: a player still open keeps it, a panel
        // that went out of sight while this ran lets it go, an editor still
        // inside the minute after a player closed keeps its minute (and gets
        // a new timer, since the one it had may have passed over this run),
        // and an output nothing else is using is let go now.
        if (audioExports || player) return;
        if (document.visibilityState === "hidden" || !audioAwake) restAudio();
        else restAudioWhenIdle();
      });
  }

  // ---------- Rendering: decorations over the syntax tree ----------

  // What shows where depends on two things: the Markdown structure, read from
  // the Lezer tree CodeMirror keeps, and where the carets are. Everything is
  // computed in one StateField, recomputed on every change of text, selection
  // or tree, over the whole document: a chapter is small, the tree walk is a
  // few milliseconds, and the expensive part (KaTeX, abcjs) happens only in
  // widget DOM, which CodeMirror reuses while the widget compares equal.

  const { Decoration, WidgetType, StateField, EditorView } = CM;

  // A range is touched when any selection range overlaps it or sits at either
  // edge. Every range, not just the main one, so each caret reveals the source
  // it is in; the edges count so that the caret arriving from outside sees the
  // marks before its next keystroke lands in them.
  function touchedBy(ranges, from, to) {
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (r.from <= to && r.to >= from) return true;
    }
    return false;
  }

  // Whether a block holds the head of the main selection, which is what puts
  // its rail of buttons up (ScoreWidget below). A point and not the range, so
  // a selection shift-arrowed or dragged over several blocks, or the whole
  // document under Ctrl+A, still stands one rail, where its head is; and two
  // blocks never share a position, one ending at the end of a line and the
  // next starting at the start of a later one.
  function holdsMainHead(state, from, to) {
    const head = state.selection.main.head;
    return head >= from && head <= to;
  }

  // Whether anybody is in the document. What a caret reveals (the marks of a
  // heading, the source under a rendered block) hangs on the selection, and a
  // selection outlives the focus: a click on the bare part of the toolbar took
  // the focus away and the heading went on showing its `##`, with no caret
  // left in it to account for them. The focus is carried into the state so the
  // decorations can go blind while the document is nobody's, which draws it as
  // it reads. The selection is left untouched, so coming back resumes where it
  // was, and the caret itself needs nothing: CodeMirror draws none without the
  // focus.
  const setFocused = CM.StateEffect.define();
  const focusField = StateField.define({
    create: function () {
      return false;
    },
    update: function (value, tr) {
      for (let i = 0; i < tr.effects.length; i++) {
        if (tr.effects[i].is(setFocused)) value = tr.effects[i].value;
      }
      return value;
    },
  });

  // While a mouse button is down, what is drawn does not change. A press
  // puts the caret in a construct and CodeMirror reads the pointer twice in
  // the same gesture, once when it lands and once when it is released (and
  // on every move between): revealing the marks in between shifted the text
  // under a pointer that had not moved (the `## ` of a heading is 65 px), so
  // the two readings named different characters and a click came out as a
  // selection of a few characters, a wobble of 3 px between press and
  // release selected a word, and the first click into an unfocused document
  // selected a range. The rendering holds its layout until the release, when
  // the reveal is drawn in one go; the selection and the focus travel as
  // they always did, only the drawing waits.
  let pointerHeld = false;
  let heldRebuild = false;
  const pointerReleased = CM.StateEffect.define();

  // What the host kept back. With the YAML header hidden the editor's first
  // line is not the file's first line, and the numbers drawn in the margin
  // count the file's lines, so that a line has the number the VS Code text
  // editor gives the same line of the same file. The host is the only side
  // that has both texts to compare, so it sends the count with the text; this
  // holds it the way focusField holds the focus, in the state, so that the
  // rendering is rebuilt when it changes.
  let hiddenLines = 0;
  const setHiddenLines = CM.StateEffect.define();
  const hiddenLinesField = StateField.define({
    create: function () {
      return hiddenLines;
    },
    update: function (value, tr) {
      for (let i = 0; i < tr.effects.length; i++) {
        if (tr.effects[i].is(setHiddenLines)) value = tr.effects[i].value;
      }
      return value;
    },
  });

  // The carets the rendering answers to: none at all while the document is
  // unfocused, which is the whole of visual mode.
  const NO_RANGES = [];
  function activeRanges(state) {
    return state.field(focusField, false) ? state.selection.ranges : NO_RANGES;
  }

  // The whole view counts as the document, not the text alone: the player bar
  // is drawn inside a block, and its volume slider and its progress bar keep
  // the browser's own focus, since both are dragged. Using them is not
  // leaving the document, and the score they play must stay open.
  //
  // The bar keeps a document that is already somebody's; what it does not do
  // is make one somebody's, and that asymmetry is the whole of the rule. A
  // document is entered by putting a caret in the text, and the headphones
  // are not a caret: they open a player and hand the bar the focus so that
  // Space plays. Counting that as entering woke the selection an untouched
  // document carries, which sits at the first character, and the block there
  // came up as source under a caret nobody had put in it. A score at the top
  // of the file opened its ABC on the first click of the session.
  //
  // Where the focus is, and not whether the window has it: an Alt+Tab to
  // another application must find the document exactly as it was left, open
  // block and all. Whether the window has the focus does not tell the two
  // apart anyway, the page being an iframe: the workbench taking it for its
  // own menu bar and the desktop taking it for another window both read as
  // `document.hasFocus()` false, and asking that question put the document
  // away on every Alt+Tab.
  function somebodyInside() {
    const active = document.activeElement;
    if (!view || !active) return false;
    // The bar is asked first, and by identity rather than by where it sits:
    // it lives in the toolbar, outside the view, so the containment test
    // below would answer "nobody" for a focus resting on the player and put
    // the document away the moment the headphones were pressed.
    if (player && player.bar && player.bar.contains(active)) {
      return !!view.state.field(focusField, false);
    }
    if (!view.dom.contains(active)) return false;
    return true;
  }

  // The last press made in the page, which is how a focus that was dropped
  // here is told from one the desktop took away. Only the pointer: the Alt of
  // an Alt+Tab does reach the page, and reading it as a press would put the
  // document away on the very gesture this is here to protect.
  let pressedAt = 0;

  // Whether the focus leaving the view was somebody's doing in the page. It
  // landing on something else in here says so outright (the toolbar, tabbed
  // to or clicked); landing nowhere is either a click on a bare stretch of
  // the page, which a press just before it accounts for, or the window being
  // handed over, which leaves the document alone.
  function leftByHand() {
    const active = document.activeElement;
    if (active && active !== document.body) return true;
    return Date.now() - pressedAt < 500;
  }

  function syncFocus() {
    if (!view) return;
    const now = somebodyInside();
    if (now === view.state.field(focusField, false)) return;
    if (!now && !leftByHand()) return;
    view.dispatch({ effects: setFocused.of(now) });
  }

  // Hands the focus back to whatever the page gives it to with nothing
  // asking, which is the body: what makes the document nobody's. Whoever
  // holds it inside the view is asked to let go, the text or a control of a
  // player bar alike.
  function leaveDocument() {
    const active = document.activeElement;
    if (!active || !active.blur || !view) return;
    // The bar is named on its own: it is the one control of the editor that
    // holds the focus from outside the view, and a focus resting there is
    // what keeps the document somebody's (somebodyInside).
    const onBar = player && player.bar && player.bar.contains(active);
    if (onBar || view.dom.contains(active)) active.blur();
  }

  // ---- KaTeX ----

  // Rendered HTML per source: the same equation is asked for on every
  // rebuild and the render is the costly step. `error` is the message KaTeX
  // gave, when it refused the source. Kept to a bound and not for the
  // session: every keystroke inside an equation is a source of its own, and
  // an evening of writing maths grew the map without end. The bound is on
  // the characters held, 16 million (some 32 MB), since a display equation
  // renders to ten times what an inline letter does; the one asked for
  // longest ago goes first, and one asked for again is the newest again. A
  // table of sixteen thousand small formulas, the bench's worst, still fits.
  const KATEX_CACHE = new Map();
  const katexHeld = { chars: 0, limit: 16e6 };

  function renderTex(tex, display) {
    const key = (display ? "D" : "I") + tex;
    let hit = KATEX_CACHE.get(key);
    if (hit) {
      KATEX_CACHE.delete(key);
      KATEX_CACHE.set(key, hit);
      return hit;
    }
    try {
      hit = {
        html: CM.katex.renderToString(tex, {
          displayMode: display,
          throwOnError: true,
        }),
        error: null,
      };
    } catch (e) {
      hit = { html: null, error: (e && e.message) || "KaTeX error" };
    }
    KATEX_CACHE.set(key, hit);
    katexHeld.chars += key.length + (hit.html || hit.error).length;
    while (katexHeld.chars > katexHeld.limit && KATEX_CACHE.size > 1) {
      const oldest = KATEX_CACHE.keys().next().value;
      const gone = KATEX_CACHE.get(oldest);
      katexHeld.chars -= oldest.length + (gone.html || gone.error).length;
      KATEX_CACHE.delete(oldest);
    }
    return hit;
  }

  // A rendered equation. Inline ones replace their source; a display one is a
  // block widget that sits under the source lines, which are hidden while no
  // caret is in them (the live preview of the block that is being edited).
  // A display one carries a copy button in a rail beside it, shown while its
  // source is open (`open`) and marked while the main caret is in it
  // (`active`), the same readings as a score's: ScoreWidget below.
  class MathWidget extends WidgetType {
    constructor(tex, display, block, preview, active, open, frame, tail) {
      super();
      this.tex = tex;
      this.display = display;
      this.block = block; // block widget (after the source) or inline replace
      // The live render an inline equation shows beside its source while it is
      // being edited: not a replacement, an extra drawing after the closing $.
      this.preview = !!preview;
      this.active = !!active;
      this.open = !!open;
      this.frame = frame || null;
      // What the closing line carries after its `$$` (`$$ {#eq-mass}`, `$$
      // where *c* is the hypotenuse.`): the parser leaves it as a paragraph
      // of its own on that line, the page runs it on after the equation, so
      // the widget draws it under the equation, painted as a cell of a
      // table is (G052). `key` is its source, for eq; `parts` its content.
      this.tail = tail || null;
    }
    eq(other) {
      return (
        other.tex === this.tex &&
        other.display === this.display &&
        other.block === this.block &&
        other.preview === this.preview &&
        other.active === this.active &&
        other.open === this.open &&
        frameKey(other.frame) === frameKey(this.frame) &&
        (other.tail ? other.tail.key : "") === (this.tail ? this.tail.key : "")
      );
    }
    className() {
      let c = this.block ? "mdm-math mdm-math--block" : "mdm-math";
      if (this.preview) c += " mdm-math--preview";
      return c;
    }
    paint(el) {
      el.className = this.className();
      const out = renderTex(this.tex, this.display);
      if (out.html) {
        el.innerHTML = out.html;
        if (this.tail) {
          const tail = document.createElement("div");
          tail.className = "mdm-math-tail";
          paintParts(tail, this.tail.parts);
          el.appendChild(tail);
        }
      } else {
        // Only a block in the middle of an edit gets here (an inline or an
        // untouched block that does not compile keeps its source instead):
        // the message tells what is still missing.
        el.className += " mdm-math--error";
        el.textContent = out.error;
      }
      // After the drawing, which the lines above write over whole. What the
      // button copies is the formula as written between the $$.
      if (this.block && !this.preview) {
        el.setAttribute("data-mdm-source", this.tex);
        const chrome = document.createElement("div");
        chrome.className = chromeClass("mdm-chrome", this);
        chrome.appendChild(chromeButton("mdm-copy", "Copy", COPY_ICON, "w"));
        el.appendChild(chrome);
      }
    }
    toDOM() {
      const el = document.createElement(this.block ? "div" : "span");
      this.paint(el);
      return framed(el, this.frame);
    }
    // The preview is rebuilt on every keystroke as the source changes; painting
    // in place instead of from scratch keeps the same element, so its entrance
    // animation plays once when it appears, not on every character typed. The
    // class is set from scratch each time because CodeMirror may hand this the
    // element of the plain (non-preview) widget it is replacing.
    //
    // A display equation whose caret came or went is the same drawing, and
    // only its rail is switched.
    updateDOM(dom, view, from) {
      if (this.preview) {
        this.paint(dom);
        return true;
      }
      if (
        this.block && from && from.block && !from.preview &&
        from.tex === this.tex && from.display === this.display
      ) {
        const chrome = unframed(dom).querySelector(":scope > .mdm-chrome");
        if (!chrome) return false;
        switchChrome(chrome, this);
        return true;
      }
      return false;
    }
    // A click on the drawing puts the caret at its source, which is what
    // opens it; the editor's own click handler does that (revealBlock), so
    // CodeMirror leaves the event alone. The preview sits after the source
    // the caret is already in, so its clicks are its own too.
    ignoreEvent() {
      return true;
    }
  }

  // ---- Scores ----

  // The engraving of a ```abc block, with its chrome: the copy button, the
  // player toggle and, while the player is open on it, the player bar. A
  // block widget after the source lines, which are hidden while no caret is
  // in them. It keeps its DOM across carets going in and out of the block,
  // and with it the player that may be sounding: a widget of the same source
  // is the same drawing, and what the caret changes is one class, switched in
  // place by updateDOM (CodeMirror reuses the element when that answers true
  // and destroys nothing).
  //
  // The buttons are a rail in the margin right of the column, out of the flow,
  // and they are shown while the reader is at the block: under the pointer
  // (.mdm-chrome--hover, chromeUnder below) or with its source open, which is
  // `open`, read off the same carets that open it (activeRanges, so nobody's
  // document has any). `active` is the score the head of the main selection
  // is in, and it is what lifts the rail over the others where the rail of a
  // short block hangs past it beside the next one's: the main head alone, and
  // not every caret or every block a selection covers, so that one block at a
  // time is the caret's (holdsMainHead; style.css, `#app .mdm-chrome`).
  class ScoreWidget extends WidgetType {
    constructor(source, active, open, frame) {
      super();
      this.source = source;
      this.active = !!active;
      this.open = !!open;
      this.frame = frame || null;
    }
    eq(other) {
      return (
        other.source === this.source &&
        other.active === this.active &&
        other.open === this.open &&
        frameKey(other.frame) === frameKey(this.frame)
      );
    }
    updateDOM(dom, view, from) {
      if (!from || from.source !== this.source) return false;
      const chrome = unframed(dom).querySelector(":scope > .mdm-chrome");
      if (!chrome) return false;
      switchChrome(chrome, this);
      return true;
    }
    toDOM() {
      const block = document.createElement("div");
      block.className = "mdm-score";
      block.setAttribute("data-mdm-source", this.source);
      // The copy over the headphones, the owner's order: the copy stands at
      // the top of every rail, a score's, an equation's and a card's, and a
      // score's own button comes under it. A button added to the rail goes
      // in here, and the rail grows down by it (flex, no height).
      const chrome = document.createElement("div");
      chrome.className = chromeClass("mdm-chrome", this);
      chrome.appendChild(chromeButton("mdm-copy", "Copy", COPY_ICON, "w"));
      chrome.appendChild(chromeButton("mdm-audio-toggle", "Show player", HEADPHONES_ICON, "w"));
      // The audio of this one score, drawn with the export glyph of the
      // toolbar: one errand, one drawing, wherever it is asked for. The
      // exported page has no rail of its own (mdm-look.css draws none), so it
      // has no audio export either; the export rule is about the document the
      // reader sees, and these buttons are not in it.
      chrome.appendChild(exportButton());
      block.appendChild(chrome);
      const code = document.createElement("code");
      code.className = "language-abc";
      block.appendChild(code);
      renderScore(code, this.source);
      return framed(block, this.frame);
    }
    // The chrome and the player are theirs, and a click on the score itself
    // is answered by the editor's click handler (revealBlock), so CodeMirror
    // leaves every event alone.
    ignoreEvent() {
      return true;
    }
    destroy() {
      // A player open on this block follows it; syncPlayer finds the block
      // that takes its place, if one does, and closes the player if none has.
      releaseScore();
    }
  }

  // The copy button of a code block, in the same rail beside the column as a
  // score's and an equation's. An inline widget of no size at the start of
  // the top line of the card, the fence while the block is open and the
  // first line of code while it is not, and placed from there against the
  // column (style.css, `.mdm-chrome--code`). Shown and marked as the others:
  // open while the fences show, active while the main caret is in the block.
  class CodeChromeWidget extends WidgetType {
    constructor(active, open) {
      super();
      this.active = !!active;
      this.open = !!open;
    }
    eq(other) {
      // One of these is like another: a copy button and nothing else.
      return other.active === this.active && other.open === this.open;
    }
    updateDOM(dom) {
      switchChrome(dom, this);
      return true;
    }
    toDOM() {
      const el = document.createElement("span");
      el.className = chromeClass("mdm-chrome mdm-chrome--code", this);
      el.appendChild(chromeButton("mdm-copy", "Copy", COPY_ICON, "w"));
      return el;
    }
    ignoreEvent() {
      return true;
    }
  }

  // The two readings a rail of buttons carries from its widget: shown while its
  // block's source is open, lifted over the others while the main caret is in
  // the block.
  function chromeClass(base, widget) {
    return base + (widget.open ? " mdm-chrome--open" : "") + (widget.active ? " mdm-chrome--active" : "");
  }

  function switchChrome(chrome, widget) {
    chrome.classList.toggle("mdm-chrome--open", widget.open);
    chrome.classList.toggle("mdm-chrome--active", widget.active);
  }

  function chromeButton(cls, label, icon, tipSide) {
    const btn = document.createElement("span");
    btn.setAttribute("role", "button");
    btn.className = cls + " mdm-tip mdm-tip--" + tipSide;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = icon;
    return btn;
  }

  // The rail's export button, with the formats it can write hanging off it.
  // The panel is built once with the button and opened by a class, the same
  // class the toolbar's menus use (mdm-toolbar__item--open), so that closing
  // one closes the other and Escape closes both, with nothing of its own to
  // keep in step. Spans and not buttons, like every other rail control: this
  // stands inside CodeMirror's content, where a focusable element would take
  // the caret with it.
  function exportButton() {
    const btn = chromeButton("mdm-audio-export", "Export audio", EXPORT_ICON, "w");
    const menu = document.createElement("span");
    menu.className = "mdm-menu";
    menu.setAttribute("role", "menu");
    AUDIO_FORMATS.forEach(function (format) {
      const row = document.createElement("span");
      row.className = "mdm-menu__item";
      row.setAttribute("role", "menuitem");
      // The name the stylesheet and the tests read, and the value the click
      // reads: a row says which format it is in the vocabulary of each.
      row.setAttribute("data-type", "mdm-audio-export-" + format.to);
      row.setAttribute("data-mdm-format", format.to);
      row.textContent = format.label;
      menu.appendChild(row);
    });
    btn.appendChild(menu);
    return btn;
  }

  // Two sheets of paper, the copy glyph of every editor, fill only.
  const COPY_ICON =
    '<svg viewBox="0 0 16 16"><path d="M5.5 2A1.5 1.5 0 0 0 4 3.5v7A1.5 1.5 0 0 0 5.5 12h6a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 11.5 2Zm0 1.2h6q.3 0 .3.3v7q0 .3-.3.3h-6q-.3 0-.3-.3v-7q0-.3.3-.3ZM2.6 5.2v7.3q0 1.5 1.5 1.5h5.6v-1.2H4.1q-.3 0-.3-.3V5.2Z"/></svg>';

  // ---- Small inline widgets ----

  // The marker of a list item, drawn in the hanging gap of the item (1.5em,
  // style.css .mdm-li-marker) in place of the marker as typed, the
  // indentation before it and the space after it: a bullet for any of `-`,
  // `*` and `+`; the number the list gives an ordered item, its start plus
  // the item's place, where the typed digits could say 1, 1, 1 and the page
  // counts 1, 2, 3 (G047); or the box of a task, which stands in the gap
  // alone, the way the page draws a task list. The bullet and the number
  // end in a space, so a row reads "• item" as it did.
  class MarkerWidget extends WidgetType {
    constructor(kind, text, checked, floating) {
      super();
      this.kind = kind;
      this.text = text;
      this.checked = !!checked;
      // Placed in the gap from the start of a line rather than in the flow:
      // the first line of a card whose fence opened on the item's line, the
      // fence being hidden with the marker on it.
      this.floating = !!floating;
    }
    eq(other) {
      return (
        other.kind === this.kind &&
        other.text === this.text &&
        other.checked === this.checked &&
        other.floating === this.floating
      );
    }
    toDOM() {
      const el = markerDOM(this);
      if (this.floating) el.classList.add("mdm-li-marker--block");
      return el;
    }
    // A click on the marker is answered in the editor's own mousedown
    // handler: the box flips the text, and the bullet or the number puts
    // the caret where the item's text starts (G066: left to CodeMirror, a
    // click on the drawing landed the caret beside the hidden `-`, and the
    // next letter unmade the item). That handler prevents the default,
    // which CodeMirror's mousedown honours on its own; ignoring the events
    // here besides says the same thing once more.
    ignoreEvent() {
      return true;
    }
  }
  function markerDOM(marker) {
    const el = document.createElement("span");
    el.className =
      "mdm-li-marker " +
      (marker.kind === "bullet" ? "mdm-bullet" : marker.kind === "number" ? "mdm-li-number" : "mdm-li-task");
    if (marker.kind === "task") {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "mdm-task";
      box.checked = marker.checked;
      box.setAttribute("aria-label", marker.checked ? "Done" : "To do");
      el.appendChild(box);
      // The space after the box at a set width (style.css, .mdm-li-gap), the
      // width the page gives its box's margin: a text space is the face's
      // and the two surfaces would not agree.
      const gap = document.createElement("span");
      gap.className = "mdm-li-gap";
      gap.textContent = " ";
      el.appendChild(gap);
    } else {
      el.textContent = marker.text + " ";
    }
    return el;
  }

  // A block drawn instead of its source inside a quote or a callout stands
  // in the frame of its first line (buildDecorations, frames): a wrapper
  // carrying the frame's classes and style, so the bars run past the block
  // and it is set in with the text around it, where until now it was drawn
  // outside the container, bar and all (G030). The frame is part of what
  // the widget is (eq), so a block that moves into or out of a container
  // is drawn again.
  function frameKey(frame) {
    return frame ? frame.key : "";
  }
  function framed(el, frame) {
    if (!frame) return el;
    const wrap = document.createElement("div");
    wrap.className = "mdm-block-framed " + frame.cls;
    wrap.setAttribute("style", frame.style);
    // A block on the first line of an item (`- ***`, an equation opened on
    // the item's line) replaces that line, marker and all: the marker is
    // drawn in the wrapper's gap instead (G029).
    if (frame.marker) {
      const marker = markerDOM(frame.marker);
      marker.classList.add("mdm-li-marker--block");
      wrap.appendChild(marker);
    }
    wrap.appendChild(el);
    return wrap;
  }
  // The block itself, wrapper or no wrapper: what updateDOM is handed. The
  // block is the wrapper's last child (a marker may stand before it).
  function unframed(dom) {
    return dom.classList.contains("mdm-block-framed") ? dom.lastElementChild : dom;
  }

  // A short run of text in place of a piece of source: the character an
  // entity stands for (`&copy;` drawn as ©), the mark of a hard break.
  class TextWidget extends WidgetType {
    constructor(text, cls) {
      super();
      this.text = text;
      this.cls = cls;
    }
    eq(other) {
      return other.text === this.text && other.cls === this.cls;
    }
    toDOM() {
      const el = document.createElement("span");
      el.className = this.cls;
      el.textContent = this.text;
      return el;
    }
    ignoreEvent() {
      return false;
    }
  }
  // ---- Characters that draw nothing (G058) ----

  // A bidi override, a zero-width space, a soft hyphen or a control character
  // is part of the text, and the page prints it as the browser does: nothing
  // to see, or a run of letters set backwards. The reading state draws what
  // the page draws. Under the caret, where a line shows its source, each is
  // drawn as a mark that names it, since a source that hides characters
  // cannot be edited. CodeMirror's highlightSpecialChars would mark them
  // everywhere, the reading state included, where a soft hyphen the author
  // put in a word on purpose would stand as a dot in the prose. Its set, and
  // the rest of the bidi embeddings and isolates (U+202A to U+202C, U+2068).
  const SPECIAL_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff\ufff9-\ufffc]/;
  const SPECIAL_NAMES = {
    0xad: "soft hyphen",
    0x61c: "Arabic letter mark",
    0x200b: "zero-width space",
    0x200e: "left-to-right mark",
    0x200f: "right-to-left mark",
    0x2028: "line separator",
    0x2029: "paragraph separator",
    0x202a: "left-to-right embedding",
    0x202b: "right-to-left embedding",
    0x202c: "pop directional formatting",
    0x202d: "left-to-right override",
    0x202e: "right-to-left override",
    0x2066: "left-to-right isolate",
    0x2067: "right-to-left isolate",
    0x2068: "first strong isolate",
    0x2069: "pop directional isolate",
    0xfeff: "zero-width no-break space",
  };
  class SpecialCharWidget extends WidgetType {
    constructor(code) {
      super();
      this.code = code;
    }
    eq(other) {
      return other.code === this.code;
    }
    toDOM() {
      const el = document.createElement("span");
      el.className = "mdm-special";
      // A control character as its picture (U+2400 on), the rest as a dot.
      el.textContent = this.code < 32 ? String.fromCharCode(0x2400 + this.code) : "\u2022";
      const hex = this.code.toString(16).toUpperCase().padStart(4, "0");
      el.title = "U+" + hex + " " + (SPECIAL_NAMES[this.code] || "control character");
      return el;
    }
    ignoreEvent() {
      return false;
    }
  }

  // A hard line break's mark, the backslash or the two spaces before the
  // line end, drawn faint at the end of the row: the break is the reader's
  // (the page writes <br>) and the row was ending there already, so the
  // mark says which row ends on purpose (G050). A soft break, one line
  // ending inside a paragraph, is drawn as a row of its own, as Typora and
  // Obsidian draw it while editing, where the page runs the lines on; that
  // difference is by design and tests/README.md records it.
  const HARD_BREAK = new TextWidget("↵", "mdm-hard-break");

  // An image alone in its paragraph is a figure (Pandoc's implicit_figures,
  // which the export runs): the page sets it with the alt text under it as
  // a caption, so the editor draws the same, a block in place of the
  // paragraph, the picture over its caption (G018). The source is covered
  // the way a table's is, so the arrow keys step into it and its number is
  // the cover's.
  class FigureWidget extends WidgetType {
    // `caption` is the alt read as inline content (cellParts), which is what
    // the page sets under the picture (`<figcaption>A <em>fine</em> photo
    // © 1741</figcaption>` for `![A *fine* photo &copy; 1741](…)`); `key` is
    // the alt as written, which is what tells two figures apart, since two
    // different sources can draw the same words.
    constructor(src, caption, key, frame, width) {
      super();
      this.src = src;
      this.caption = caption;
      this.key = key;
      this.frame = frame || null;
      // The width the image's attribute asks for (`{width=30%}`), which the
      // page gives the picture (G014).
      this.width = width || null;
    }
    eq(other) {
      return (
        other.src === this.src &&
        other.key === this.key &&
        other.width === this.width &&
        frameKey(other.frame) === frameKey(this.frame)
      );
    }
    toDOM(view) {
      const fig = document.createElement("div");
      fig.className = "mdm-figure";
      const img = document.createElement("img");
      img.className = "mdm-image";
      if (this.width) img.style.width = this.width;
      const remeasure = function () {
        if (view.viewState) view.viewState.mustMeasureContent = true;
        view.requestMeasure();
      };
      img.addEventListener("load", remeasure);
      img.addEventListener("error", remeasure);
      img.src = this.src;
      // The alt attribute is the caption's words without their marks, which
      // is what the page writes into it.
      img.alt = partsText(this.caption);
      fig.appendChild(img);
      const caption = document.createElement("div");
      caption.className = "mdm-figcaption";
      paintParts(caption, this.caption);
      fig.appendChild(caption);
      return framed(fig, this.frame);
    }
    // The click is the editor's (revealBlock), as on a table.
    ignoreEvent() {
      return true;
    }
  }

  // A fenced block with no body (three backticks, three backticks): both
  // fence lines used to be hidden and nothing stood for the block, no card,
  // no rail, no number (G035). It is drawn as an empty card in their place,
  // carrying the number of its first line; a caret on either line opens it.
  class EmptyCardWidget extends WidgetType {
    constructor(n, frame) {
      super();
      this.n = n;
      this.frame = frame || null;
    }
    eq(other) {
      return other.n === this.n && frameKey(other.frame) === frameKey(this.frame);
    }
    toDOM() {
      const el = document.createElement("div");
      el.className = "mdm-empty-card";
      el.setAttribute("data-mdm-line", String(this.n));
      return framed(el, this.frame);
    }
    ignoreEvent() {
      return false;
    }
  }

  // The rule carries the number of its line, the way a block cover does: the
  // line is replaced whole, so the number decoration on it is never reached
  // and the margin used to jump from 2 to 4 around a rule (G044).
  class RuleWidget extends WidgetType {
    constructor(n, frame) {
      super();
      this.n = n;
      this.frame = frame || null;
    }
    eq(other) {
      return other.n === this.n && frameKey(other.frame) === frameKey(this.frame);
    }
    toDOM() {
      const el = document.createElement("div");
      el.className = "mdm-hr";
      el.setAttribute("data-mdm-line", String(this.n));
      return framed(el, this.frame);
    }
    ignoreEvent() {
      return false;
    }
  }

  class ImageWidget extends WidgetType {
    constructor(src, alt, width) {
      super();
      this.src = src;
      this.alt = alt;
      this.width = width || null;
    }
    eq(other) {
      return other.src === this.src && other.alt === this.alt && other.width === this.width;
    }
    toDOM(view) {
      const img = document.createElement("img");
      img.className = "mdm-image";
      if (this.width) img.style.width = this.width;
      // The picture arrives after the line was measured, and CodeMirror
      // has no way of knowing: its height map kept the line at one row of
      // text, a click below the picture landed lines lower than the word
      // it was on, and the caret went where the map said (G100). A load,
      // or the broken-image glyph of a failure, asks for the line heights
      // to be read again. requestMeasure alone reads nothing: the heights
      // are re-read when the content's box changed height, and the box is
      // stretched to the scroller (measured 2365 px before and after a
      // 256 px picture), so the flag that forces the reading is set by
      // hand. It is CodeMirror's own, not in its documented API; the test
      // that reads the map after a load is what says the next bump kept it.
      const remeasure = function () {
        if (view.viewState) view.viewState.mustMeasureContent = true;
        view.requestMeasure();
      };
      img.addEventListener("load", remeasure);
      img.addEventListener("error", remeasure);
      img.src = this.src;
      img.alt = this.alt;
      img.title = this.alt;
      return img;
    }
    ignoreEvent() {
      return false;
    }
  }

  // An image path as written in the file, turned into a URI the webview may
  // load. A URL is passed through; a relative path hangs from the folder of
  // the document and an absolute one from the root of the filesystem, both
  // handed over by the host as webview URIs (MDM_DOC_BASE, MDM_FILE_BASE).
  // The two are told apart because a leading slash resolved against the
  // folder of the document used to give a path with the document's own folder
  // glued in front of it, which no server would find.
  function imageSource(src) {
    // A file:// URL is a URL, not a path to hang from the folder (G023).
    if (/^(https?:|file:|data:|vscode-)/i.test(src)) return src;
    const drive = /^[A-Za-z]:[/\\]/.exec(src); // C:\ and the like
    const absolute = !!drive || src.charAt(0) === "/" || src.charAt(0) === "\\";
    const base = absolute ? window.MDM_FILE_BASE || "" : window.MDM_DOC_BASE || "";
    if (!base) return null;
    // The root is already in the base, whichever shape it has on this system.
    const rest = absolute
      ? src.slice(drive ? drive[0].length : 1).replace(/\\/g, "/")
      : src.replace(/^\.\//, "");
    return base.replace(/\/?$/, "/") + rest;
  }

  // ---- Tables ----

  // The inline marks a table cell may carry, and the element each is drawn
  // in. The marks themselves (`**`, the backticks) are children whose name
  // ends in Mark and are skipped wherever they turn up.
  const CELL_TAGS = {
    Emphasis: "em",
    StrongEmphasis: "strong",
    Strikethrough: "s",
    InlineCode: "code",
    Superscript: "sup",
    Subscript: "sub",
  };

  // The parts of a link that are not its label: skipped when the label is
  // read, so `[text](url "title")` draws as its text alone and a reference
  // (`[text][ref]`) draws as its text without the `[ref]` after it (G002).
  const LINK_SKIP = /^(URL|LinkTitle|LinkLabel)$/;

  // The inline content of a cell, read off the syntax tree once and kept as
  // plain data: the widget is built while the tree is at hand and drawn
  // later, when it is not. `skip` names the children that carry no text of
  // their own (the URL of a link, its title). `marks` is the punctuation of
  // the block as the page prints it (smartMarks), drawn into the text; a
  // caller that wants the source as written leaves it out. `refs` are the
  // document's link definitions (definitionsOf), so a link or an image
  // written by reference finds where it goes here as it does in the prose.
  function cellParts(node, text, skip, marks, refs) {
    const parts = [];
    const push = function (s) {
      if (s) parts.push({ kind: "text", text: s });
    };
    const slice = function (from, to) {
      return marks ? smartSlice(text, from, to, marks) : text(from, to);
    };
    let at = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      push(slice(at, child.from));
      at = child.to;
      const name = child.name;
      if (/Mark$/.test(name) || name === "Attribute" || (skip && skip.test(name))) continue;
      if (name === "Span") {
        parts.push({ kind: "mark", tag: "span", parts: cellParts(child, text, skip, marks, refs) });
        continue;
      }
      if (name === "InlineMath" || name === "InlineBlockMath") {
        const display = name === "InlineBlockMath";
        const content = child.getChild(
          display ? "InlineBlockMathContent" : "InlineMathContent"
        );
        parts.push({
          kind: "math",
          tex: content ? text(content.from, content.to) : "",
          display: display,
          source: text(child.from, child.to),
        });
      } else if (name === "Escape") {
        push(text(child.from + 1, child.to));
      } else if (name === "Entity") {
        // `&copy;` is © here as it is in the prose; one that stands for
        // nothing stays as written (G009).
        push(decodeEntity(text(child.from, child.to)));
      } else if (name === "Image") {
        // `ends` and not `marks`: the outer `marks` are the block's smart
        // punctuation, which the alt is drawn with like any other text.
        const target = linkTarget(child, text, refs);
        const ends = child.getChildren("LinkMark");
        parts.push({
          kind: "image",
          src: target && target.url ? imageSource(target.url) : null,
          alt: ends.length > 1 ? slice(ends[0].to, ends[1].from) : "",
        });
      } else if (name === "Link" || name === "Autolink" || name === "URL") {
        const target = name === "Link" ? linkTarget(child, text, refs) : null;
        const url = child.getChild("URL");
        const inner = cellParts(child, text, LINK_SKIP, marks, refs);
        parts.push({
          kind: "link",
          href: target && target.url ? target.url : url ? unbracket(text(url.from, url.to)) : partsText(inner),
          title: target ? target.title : "",
          parts: inner,
        });
      } else if (name === "HTMLTag" && /^<br\s*\/?>$/i.test(text(child.from, child.to))) {
        // A `<br>` is a line break in the cell, as the page writes it (G020);
        // any other raw tag stays as written, as it does in the prose.
        parts.push({ kind: "br" });
      } else if (name === "FootnoteRef") {
        // The label raised, the marks off, as the prose raises it and as the
        // page raises the number it gives the note (<sup>1</sup> in a cell).
        const ends = child.getChildren("FootnoteMark");
        const label = ends.length > 1 ? text(ends[0].to, ends[1].from) : text(child.from, child.to);
        parts.push({
          kind: "mark",
          tag: "span",
          cls: "mdm-note-ref mdm-sup",
          title: "Footnote " + label,
          parts: [{ kind: "text", text: label }],
        });
      } else if (name === "FootnoteInline") {
        parts.push({
          kind: "mark",
          tag: "span",
          cls: "mdm-note-inline",
          title: "Footnote, written inline",
          parts: cellParts(child, text, skip, marks, refs),
        });
      } else if (name === "Citation") {
        const raw = text(child.from, child.to);
        parts.push({
          kind: "mark",
          tag: "span",
          cls: "mdm-cite",
          title: (raw.charAt(0) === "[" ? "Citation " : "Reference ") + raw,
          parts: [{ kind: "text", text: raw }],
        });
      } else if (name === "RawTeX") {
        // The HTML page leaves raw TeX out altogether (measured: a cell
        // holding `\emph{x}` comes back as <td></td>), so a cell says what
        // it is instead of drawing it as words, as the prose does (G013).
        parts.push({
          kind: "mark",
          tag: "span",
          cls: "mdm-rawtex",
          title: "Raw TeX: set in the PDF, left out of the HTML page",
          parts: [{ kind: "text", text: text(child.from, child.to) }],
        });
      } else if (CELL_TAGS[name]) {
        parts.push({ kind: "mark", tag: CELL_TAGS[name], parts: cellParts(child, text, skip, marks, refs) });
      } else {
        push(slice(child.from, child.to));
      }
    }
    push(slice(at, node.to));
    return parts;
  }

  // What a run of parts says, for the title of a link that carries its own
  // address as its label.
  function partsText(parts) {
    return parts
      .map(function (p) {
        return p.kind === "text" ? p.text : p.kind === "math" ? p.source : p.parts ? partsText(p.parts) : "";
      })
      .join("");
  }

  function paintParts(el, parts) {
    parts.forEach(function (p) {
      if (p.kind === "text") {
        el.appendChild(document.createTextNode(p.text));
        return;
      }
      if (p.kind === "math") {
        const out = renderTex(p.tex, p.display);
        const span = document.createElement("span");
        span.className = "mdm-math";
        if (out.html) {
          span.innerHTML = out.html;
        } else {
          // A cell whose LaTeX does not compile keeps the source it was
          // written with, the way an inline equation in prose does.
          span.className += " mdm-math--error";
          span.textContent = p.source;
        }
        el.appendChild(span);
        return;
      }
      if (p.kind === "br") {
        el.appendChild(document.createElement("br"));
        return;
      }
      if (p.kind === "image") {
        if (!p.src) {
          el.appendChild(document.createTextNode(p.alt));
          return;
        }
        const img = document.createElement("img");
        img.className = "mdm-image";
        img.src = p.src;
        img.alt = p.alt;
        img.title = p.alt;
        el.appendChild(img);
        return;
      }
      if (p.kind === "link") {
        // A span and not an anchor: the click belongs to the editor, which
        // puts the caret in the source, as it does everywhere else.
        const link = document.createElement("span");
        link.className = "mdm-link";
        // The tooltip is the destination and the Markdown title rides
        // beside it, the pair a link in the prose carries.
        if (p.href) link.title = p.href;
        if (p.title) link.setAttribute("data-mdm-title", p.title);
        paintParts(link, p.parts);
        el.appendChild(link);
        return;
      }
      const mark = document.createElement(p.tag);
      if (p.cls) mark.className = p.cls;
      else if (p.tag === "code") mark.className = "mdm-inline-code";
      if (p.title) mark.title = p.title;
      paintParts(mark, p.parts);
      el.appendChild(mark);
    });
  }

  // The rows of a pipe table and the alignment of its columns. The alignment
  // row (`| ---: | :--- |`) is the one TableDelimiter that is a child of the
  // table itself; the delimiters inside a row are the pipes between cells.
  function tableModel(node, text, refs) {
    const rule = node.getChildren("TableDelimiter")[0];
    const align = (rule ? text(rule.from, rule.to) : "")
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map(function (spec) {
        const s = spec.trim();
        const left = s.charAt(0) === ":";
        const right = s.charAt(s.length - 1) === ":";
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return null;
      });
    // The cells of a row, read between its pipes and not off the TableCell
    // nodes alone: Lezer gives no node for an empty cell (`|   |`), so a row
    // read that way lost its columns and every value after a gap slid left
    // (G036). A stretch between two pipes is a cell whatever it holds; the
    // stretch before the first pipe and the one after the last are cells
    // only when they hold something, since a row may leave its outer pipes
    // off (GFM 4.10). Where each cell starts is counted from the head of
    // the table and not from the head of the document: the drawing outlives
    // the edits made above it (it compares equal while its own source is
    // the same), and an absolute position kept in the DOM would be stale by
    // the time it is clicked. The head of the table is the node's own start,
    // which is what revealBlock counts from when the click comes back.
    const cells = function (row) {
      const out = [];
      const nodes = row.getChildren("TableCell");
      const stretch = function (from, to, outer) {
        const inner = text(from, to);
        if (outer && !inner.trim()) return;
        const content = nodes.filter(function (c) {
          return c.from >= from && c.to <= to;
        })[0];
        const lead = inner.length - inner.replace(/^[ \t]+/, "").length;
        out.push({
          at: (content ? content.from : from + lead) - node.from,
          parts: content ? cellParts(content, text, null, smartMarks(content, content.to, text), refs) : [],
        });
      };
      let at = row.from;
      row.getChildren("TableDelimiter").forEach(function (pipe, i) {
        stretch(at, pipe.from, i === 0);
        at = pipe.to;
      });
      stretch(at, row.to, true);
      return out;
    };
    // The header says how many columns there are, and every row is fitted
    // to it the way GFM and Pandoc fit it: a short row is given empty cells
    // and a long one loses the excess (G036). A cell added this way points
    // at the end of its row, so a click on it opens the source there.
    const head = node.getChild("TableHeader");
    const headCells = head ? cells(head) : [];
    const fit = function (row) {
      const out = cells(row).slice(0, headCells.length);
      while (out.length < headCells.length) out.push({ at: row.to - node.from, parts: [] });
      return out;
    };
    return {
      align: align,
      head: headCells,
      body: node.getChildren("TableRow").map(fit),
    };
  }

  // A drawn table, a block widget under the source lines, which are hidden
  // while no caret is in them. Equal while the source is the same, so the
  // element survives carets going in and out of the document around it.
  class TableWidget extends WidgetType {
    constructor(source, model, frame) {
      super();
      this.source = source;
      this.model = model;
      this.frame = frame || null;
    }
    eq(other) {
      return other.source === this.source && frameKey(other.frame) === frameKey(this.frame);
    }
    toDOM() {
      const model = this.model;
      // The scroller is the widget itself: a table wider than the page is
      // pushed around inside it instead of stretching the document.
      const wrap = document.createElement("div");
      wrap.className = "mdm-table";
      const table = document.createElement("table");
      const cell = function (c, i, tag) {
        const el = document.createElement(tag);
        if (model.align[i]) el.style.textAlign = model.align[i];
        el.dataset.mdmAt = String(c.at);
        paintParts(el, c.parts);
        return el;
      };
      if (model.head.length) {
        const head = document.createElement("thead");
        const tr = document.createElement("tr");
        model.head.forEach(function (c, i) {
          tr.appendChild(cell(c, i, "th"));
        });
        head.appendChild(tr);
        table.appendChild(head);
      }
      const body = document.createElement("tbody");
      model.body.forEach(function (row) {
        const tr = document.createElement("tr");
        row.forEach(function (c, i) {
          tr.appendChild(cell(c, i, "td"));
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);
      return framed(wrap, this.frame);
    }
    // The click puts the caret at the source, which the editor's own handler
    // does (revealBlock); CodeMirror leaves the event alone.
    ignoreEvent() {
      return true;
    }
  }

  // ---- The walk ----

  // Line-level classes are gathered per line and emitted once: a line can be
  // in a callout, in a list and in a quote at the same time.
  function lineClassCollector(doc) {
    const lines = new Map(); // line number -> Set of classes
    const marks = new Map(); // the same, for classes that leave `bare` alone
    const styles = new Map(); // line number -> extra style declarations
    const widths = new Map(); // line number -> characters of its card's longest line
    const addTo = function (map, from, to, cls) {
      const first = doc.lineAt(from).number;
      const last = doc.lineAt(Math.max(from, to)).number;
      for (let n = first; n <= last; n++) {
        let set = map.get(n);
        if (!set) map.set(n, (set = new Set()));
        cls.split(" ").forEach(function (c) {
          if (c) set.add(c);
        });
      }
    };
    return {
      // Whether a line has been given no class at all, which is what says it
      // is prose: every block of the document (a fence, the front matter, a
      // table) classes the lines it covers. A container (a quote, a list
      // item, a callout) does not: its lines are prose in a frame, and a
      // blank one among them is the em-tall gap a blank line is (mdm-blank),
      // so containers class their lines through `mark` below.
      bare: function (n) {
        return !lines.has(n);
      },
      add: function (from, to, cls) {
        addTo(lines, from, to, cls);
      },
      mark: function (from, to, cls) {
        addTo(marks, from, to, cls);
      },
      style: function (n, css) {
        styles.set(n, (styles.get(n) ? styles.get(n) + "; " : "") + css);
      },
      // The card a line belongs to, in characters of its longest line. A
      // card's lines keep their lines (style.css) and are therefore as wide
      // as their text, so without this each line of a block was its own
      // width and the card's ground came out with a ragged right edge: on
      // the python block of example.mdm at a 520 px pane, twenty different
      // edges between 470 and 633 px. The lines of a card share one width
      // instead, the widest line's, and the sheet works it out from this
      // number in `ch`, the advance of the monospace they are all set in.
      //
      // Counted from the document and not measured from the DOM, because
      // CodeMirror renders the lines in view and a little beyond: measured,
      // a card longer than the viewport would change width as it was
      // scrolled through.
      card: function (from, to) {
        const first = doc.lineAt(from).number;
        const last = doc.lineAt(Math.max(from, to)).number;
        let most = 0;
        for (let n = first; n <= last; n++) {
          most = Math.max(most, doc.line(n).length);
        }
        for (let n = first; n <= last; n++) {
          widths.set(n, Math.max(widths.get(n) || 0, most));
        }
      },
      decorations: function () {
        const out = [];
        const numbers = new Set();
        lines.forEach(function (set, n) {
          numbers.add(n);
        });
        marks.forEach(function (set, n) {
          numbers.add(n);
        });
        styles.forEach(function (css, n) {
          numbers.add(n);
        });
        numbers.forEach(function (n) {
          const all = new Set(lines.get(n) || []);
          (marks.get(n) || []).forEach(function (c) {
            all.add(c);
          });
          const spec = {};
          if (all.size) spec.class = Array.from(all).join(" ");
          const style = [];
          const chars = widths.get(n);
          if (chars) style.push("--mdm-card-chars: " + chars);
          if (styles.has(n)) style.push(styles.get(n));
          if (style.length) spec.attributes = { style: style.join("; ") };
          out.push(Decoration.line(spec).range(doc.line(n).from));
        });
        return out;
      },
    };
  }

  // Which fence info strings are scores: ```abc and Pandoc's ```{.abc .play}.
  function isAbcInfo(info) {
    return /^(abc\b|\{\s*\.abc\b)/.test(info.trim());
  }

  // Where a fenced block ends: the closing fence when it has one, and the end
  // of the last line the node covers when the document stops before it. It is
  // the position a block widget hangs on, which is how a rail button and the
  // export find the same score (ScoreWidget, documentScores).
  function scoreEnd(doc, node, to) {
    const marks = node.getChildren("CodeMark");
    return marks.length > 1 ? doc.lineAt(marks[1].from).to : doc.lineAt(to).to;
  }

  // The body of a fenced block, its CodeText children as one range. At the
  // top level Lezer gives one; inside a list item or a quote it gives one
  // per line, the container's indentation and > marks left out, and the
  // editor read the first alone: a score in a list was engraved from its
  // first line, Copy copied one line, and a card's bottom edge landed on
  // its second line (G034).
  function fenceBody(node) {
    const parts = node.getChildren("CodeText");
    return parts.length ? { from: parts[0].from, to: parts[parts.length - 1].to } : null;
  }
  // The source of the block, line by line: the parts Lezer gives, and a
  // line break for every line of the block it gives no part for (a blank
  // line inside a quoted fence).
  function fenceSource(doc, node) {
    const parts = node.getChildren("CodeText");
    if (!parts.length) return "";
    const marks = node.getChildren("CodeMark");
    const end = marks.length > 1 ? doc.lineAt(marks[1].from).number : doc.lineAt(node.to).number + 1;
    let out = "";
    let n = doc.lineAt(parts[0].from).number;
    parts.forEach(function (part) {
      const at = doc.lineAt(part.from).number;
      while (n < at) {
        out += "\n";
        n++;
      }
      out += doc.sliceString(part.from, part.to);
      const last = doc.lineAt(part.to).number;
      n = doc.sliceString(part.to - 1, part.to) === "\n" ? last : last + 1;
    });
    while (n < end) {
      out += "\n";
      n++;
    }
    return out;
  }

  // The number of a source line, carried on the line itself rather than drawn
  // in a gutter: a gutter of CodeMirror's is a column at the head of the
  // scroller, and the text of this editor is a centred column, so the two
  // stand as far apart as the pane is wide. The stylesheet prints the
  // attribute in the margin of the text instead, where it travels with the
  // column.
  //
  // One object per number, kept for the life of the view. The spec of a number
  // never changes, so two rebuilds hand CodeMirror the same decoration for the
  // same line and it can see that the line's attributes did not move.
  const LINE_NUMBERS = [];
  function lineNumber(n) {
    return (
      LINE_NUMBERS[n] ||
      (LINE_NUMBERS[n] = Decoration.line({ attributes: { "data-mdm-line": String(n) } }))
    );
  }

  // The cover over the source of a block that is drawn instead of it. It
  // stands where CodeMirror would otherwise put an empty placeholder of its
  // own: no height, hidden in the same way, and carrying the number of the
  // first line it swallows. The lines under it are out of the flow and their
  // own numbers are never reached, so without this a drawn block would be a
  // hole in the numbering.
  //
  // The number is the whole of its state, so a block whose position changes
  // updates the attribute and never the drawing beside it, which for a score
  // is an engraving.
  class BlockCoverWidget extends WidgetType {
    constructor(n) {
      super();
      this.n = n;
    }
    eq(other) {
      return other.n === this.n;
    }
    toDOM() {
      const el = document.createElement("div");
      el.className = "mdm-blockline";
      el.setAttribute("data-mdm-line", String(this.n));
      return el;
    }
    updateDOM(el) {
      el.setAttribute("data-mdm-line", String(this.n));
      return true;
    }
    // The same answer CodeMirror's own placeholder gives, so that mapping a
    // position into the DOM meets what it met before.
    get isHidden() {
      return true;
    }
  }

  // Marks hidden while their node is not touched: the node name and the names
  // of its marker children.
  const INLINE_MARKS = {
    Emphasis: ["EmphasisMark"],
    StrongEmphasis: ["EmphasisMark"],
    Strikethrough: ["StrikethroughMark"],
    InlineCode: ["CodeMark"],
    Subscript: ["SubscriptMark"],
    Superscript: ["SuperscriptMark"],
  };

  // Pandoc's attribute block, `{#id .class key=val}` (G014): its items, the
  // classes among them, the value of a key, and whether a text is one, by
  // the parser's rule (vendor-src/src/markdown/pandoc.js, attributeEnd).
  function attributeItems(s) {
    const inner = s.replace(/^\{|\}$/g, "").trim();
    return inner ? inner.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [] : [];
  }
  function attributeClasses(s) {
    return attributeItems(s)
      .filter(function (item) {
        return item.charAt(0) === ".";
      })
      .map(function (item) {
        return item.slice(1);
      });
  }
  function attributeValue(s, key) {
    const items = attributeItems(s);
    for (let i = 0; i < items.length; i++) {
      const m = /^([^=]+)=(.*)$/.exec(items[i]);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
    }
    return null;
  }
  const ATTR_ITEM = /^(?:#[^\s}#.]+|\.[^\s}#.]+|[^\s}=]+=(?:"[^"]*"|'[^']*'|[^\s}]+)|=[^\s}]+|-)$/;
  function isAttribute(s) {
    const items = attributeItems(s);
    return /^\{[^{}\n]*\}$/.test(s) && items.length > 0 && items.every(function (item) {
      return ATTR_ITEM.test(item);
    });
  }
  // A width as Pandoc reads it into the page: a bare number is pixels, and
  // a unit goes through as written (30%, 2in).
  function cssLength(v) {
    if (!v) return null;
    return /^\d+(?:\.\d+)?$/.test(v) ? v + "px" : v;
  }

  // ---- Smart punctuation (G015) ----

  // Pandoc's Markdown keeps its `smart` extension on, so the page prints
  // curly double and single quotes, an apostrophe as a closing single quote,
  // an en dash for `--`, an em dash for `---` and an ellipsis for `...`,
  // where the editor drew the ASCII as typed. While a line is untouched its
  // prose is drawn as the page prints it, the source left as written; the
  // line under the caret shows the source. Code, maths, an address, a tag, a
  // comment, an entity, an escape, raw TeX, an attribute, a citation, an
  // image and a link's destination and title are left alone, as the page
  // leaves them.
  //
  // The quotes follow Pandoc's reader (pandoc 3.8.3, read off its output on
  // 2026-09-17): a quote opens when it does not follow a letter or a digit
  // and is not followed by a space or the end of its line; a `"` that cannot
  // open is a closing one, whether or not one is open; a `'` that cannot
  // open is an apostrophe, and so is one that opens and never closes ('90s,
  // 'tis), where a `"` that never closes stays an opening one. Inside an
  // open pair the next `"` closes it, and a `'` closes only when no letter
  // or digit follows ('quoted's'), and not when it stands right after its
  // opener (''). The context runs over the whole block, past its line ends
  // and its code spans, and a pair inside a pair nests. An emphasis, a
  // link's text, a span and a note are each one inline to Pandoc, though:
  // a pair opened outside one does not close inside it ('a *b' c* d has no
  // pair), and one opened inside closes inside or not at all.
  const SMART_LEAF = /^(InlineCode|InlineMath|InlineBlockMath|URL|Autolink|LinkTitle|LinkLabel|HTMLTag|Comment|ProcessingInstruction|Escape|Entity|RawTeX|Attribute|Citation|FootnoteRef|Image|HardBreak|Emoji|TaskMarker|LongDelimiterRun)$|Mark$/;
  const SMART = /---|--|\.\.\.|["']/g;
  const WORD_CHAR = /[\p{L}\p{N}]/u;
  const SMART_NONE = 0;
  const SMART_DOUBLE = 1;
  const SMART_SINGLE = 2;

  // The punctuation of one block up to `limit` (a heading's hidden
  // attributes are past it): every mark goes into `all`, in order, and the
  // quotes come back as Pandoc's inline parser meets them, the ones inside
  // a nested inline as a group of their own. `blockEnd` is where the block
  // ends, past which nothing follows a quote.
  function smartItems(node, limit, text, blockEnd, all) {
    const items = [];
    const scan = function (from, to) {
      if (to <= from) return;
      const s = text(from, to);
      SMART.lastIndex = 0;
      let m;
      while ((m = SMART.exec(s))) {
        const t = { pos: from + m.index, len: m[0].length, ch: m[0], glyph: null };
        all.push(t);
        if (m[0] === "---") t.glyph = "\u2014";
        else if (m[0] === "--") t.glyph = "\u2013";
        else if (m[0] === "...") t.glyph = "\u2026";
        else {
          const before = t.pos > 0 ? text(t.pos - 1, t.pos) : "";
          const after = t.pos + 1 < blockEnd ? text(t.pos + 1, t.pos + 2) : "";
          t.opens = !WORD_CHAR.test(before) && !/^[ \t\r\n]?$/.test(after);
          t.closesSingle = t.ch === "'" && !WORD_CHAR.test(after);
          items.push(t);
        }
      }
    };
    let at = node.from;
    for (let child = node.firstChild; child && child.from < limit; child = child.nextSibling) {
      scan(at, child.from);
      if (!SMART_LEAF.test(child.name)) {
        items.push({ group: smartItems(child, Math.min(child.to, limit), text, blockEnd, all) });
      }
      at = child.to;
    }
    scan(at, limit);
    return items;
  }

  // Which quote each `"` and `'` is, by the rules above. `ctx` is the pair
  // the items stand in, which they can neither open again nor close.
  function smartQuotes(items, ctx) {
    const memo = new Map();
    // The item that closes `c` when scanned from item i on (its opener is
    // item i - 1), or -1 when the items end first. A pair opened on the way
    // is stepped over whole; one that never closes is stepped into, as
    // Pandoc's reader backtracks and reads its inside again.
    function end(i, c) {
      const key = i * 3 + c;
      if (memo.has(key)) return memo.get(key);
      let k = i;
      let found = -1;
      while (k < items.length) {
        const t = items[k];
        if (t.group) {
          k++;
          continue;
        }
        const closes = c === SMART_DOUBLE ? t.ch === '"' : t.closesSingle && !(k === i && t.pos === items[i - 1].pos + 1);
        if (closes) {
          found = k;
          break;
        }
        const inner = t.ch === '"' ? SMART_DOUBLE : SMART_SINGLE;
        if (t.opens && inner !== c) {
          const j = end(k + 1, inner);
          if (j >= 0) {
            k = j + 1;
            continue;
          }
        }
        k++;
      }
      memo.set(key, found);
      return found;
    }
    function walk(i, c, stop) {
      let k = i;
      while (k < stop) {
        const t = items[k];
        if (t.group) {
          smartQuotes(t.group, c);
          k++;
          continue;
        }
        const inner = t.ch === '"' ? SMART_DOUBLE : SMART_SINGLE;
        if (t.opens && inner !== c) {
          const j = end(k + 1, inner);
          if (j >= 0) {
            t.glyph = inner === SMART_DOUBLE ? "\u201c" : "\u2018";
            items[j].glyph = inner === SMART_DOUBLE ? "\u201d" : "\u2019";
            walk(k + 1, inner, j);
            k = j + 1;
            continue;
          }
          t.glyph = inner === SMART_DOUBLE ? "\u201c" : "\u2019";
        } else t.glyph = t.ch === '"' ? "\u201d" : "\u2019";
        k++;
      }
    }
    walk(0, ctx, items.length);
  }

  // The marks of one block with the glyph each is printed as, in order.
  function smartMarks(node, limit, text) {
    const all = [];
    smartQuotes(smartItems(node, limit, text, limit, all), SMART_NONE);
    return all;
  }

  // In the document the glyphs are widgets over the source, line by line.
  function smartWidgets(node, limit, text, doc, touched, decos) {
    smartMarks(node, limit, text).forEach(function (t) {
      const line = doc.lineAt(t.pos);
      if (!t.glyph || touched(line.from, line.to)) return;
      decos.push(Decoration.replace({ widget: new TextWidget(t.glyph, "mdm-smart") }).range(t.pos, t.pos + t.len));
    });
  }

  // What is drawn from a string and not from the document, a table's cell,
  // an outline row, a figure's caption, the prose after an equation, takes
  // the glyphs into the string: the text of [from, to) as the page prints it.
  function smartSlice(text, from, to, marks) {
    let out = "";
    let at = from;
    marks.forEach(function (t) {
      if (!t.glyph || t.pos < at || t.pos + t.len > to) return;
      out += text(at, t.pos) + t.glyph;
      at = t.pos + t.len;
    });
    return out + text(at, to);
  }

  // Where the text of a heading ends: before Pandoc's header attributes,
  // `{#id .class}` at the end of the line, which the page prints none of
  // (G014). No node: an inline parser cannot tell a heading's line from a
  // paragraph's.
  function headingTextEnd(n, text) {
    const attr = /[ \t]+(\{[^{}\n]*\})[ \t]*$/.exec(text(n.from, n.to));
    return attr && isAttribute(attr[1]) ? n.from + attr.index : n.to;
  }

  const ENTITY_CACHE = new Map();

  // The blocks of raw HTML, as Lezer names them: an element's (CommonMark's
  // HTML blocks 1 and 4 to 7), a comment's (2) and a processing
  // instruction's (3, `<?...?>`). One list for every place that names them:
  // the third was in none, so it was drawn as prose in the text face, and
  // the second was missing where a mark is kept off a line and where
  // Ctrl+Enter leaves a block (G048).
  const RAW_HTML = "HTMLBlock|CommentBlock|ProcessingInstructionBlock";
  const RAW_HTML_BLOCK = new RegExp("^(?:" + RAW_HTML + ")$");

  // The definitions of a document (`[label]: url "title"`, anywhere in it),
  // read once per tree and not once per rebuild: a rebuild of a few blocks
  // (below) would otherwise walk the whole tree for them every time. A label
  // matches as CommonMark 4.7 matches it: trimmed, its whitespace collapsed,
  // case folded.
  const definitionsByTree = new WeakMap();
  function refKey(label) {
    return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase();
  }
  // A destination written in angle brackets is the address inside them
  // (G006).
  function unbracket(dest) {
    const m = /^<(.*)>$/.exec(dest);
    return m ? m[1] : dest;
  }
  function definitionsOf(state, tree) {
    let refs = definitionsByTree.get(tree);
    if (refs) return refs;
    refs = new Map();
    const text = function (from, to) {
      return state.doc.sliceString(from, to);
    };
    tree.iterate({
      enter: function (n) {
        if (n.name !== "LinkReference") return;
        const node = n.node;
        const label = node.getChild("LinkLabel");
        const url = node.getChild("URL");
        if (label && url) {
          const key = refKey(text(label.from + 1, label.to - 1));
          const title = node.getChild("LinkTitle");
          // The first definition of a label is the one that counts (CM 4.7).
          if (!refs.has(key)) {
            refs.set(key, {
              url: unbracket(text(url.from, url.to)),
              title: title ? text(title.from + 1, title.to - 1) : "",
            });
          }
        }
        return false;
      },
    });
    definitionsByTree.set(tree, refs);
    return refs;
  }

  // Where a link or an image goes: the URL after its closing `]`, never one
  // the GFM autolinker found inside the label (G005); or, by reference, the
  // definition its label names, the label being the text in the second
  // brackets when there is one and the link's own text when they are empty
  // or absent. The prose and the inside of a table cell ask the same
  // question, so they ask it here: the cells used to read the first URL they
  // found and keep the label as their text (G002, G004, G006).
  function linkTarget(node, text, refs) {
    const marks = node.getChildren("LinkMark");
    if (marks.length < 2) return null;
    const close = marks[1];
    const url = node.getChildren("URL").filter(function (u) {
      return u.from >= close.to;
    })[0];
    if (url) {
      const title = node.getChildren("LinkTitle").filter(function (t) {
        return t.from >= close.to;
      })[0];
      return { url: unbracket(text(url.from, url.to)), title: title ? text(title.from + 1, title.to - 1) : "" };
    }
    const label = node.getChild("LinkLabel");
    const inner = label && label.to - label.from > 2 ? text(label.from + 1, label.to - 1) : text(marks[0].to, close.from);
    return (refs && refs.get(refKey(inner))) || null;
  }

  // The character an entity stands for, or the entity itself when it stands
  // for nothing (`&bogus;`), decoded by the browser.
  function decodeEntity(raw) {
    let out = ENTITY_CACHE.get(raw);
    if (out === undefined) {
      const box = document.createElement("textarea");
      box.innerHTML = raw;
      out = box.value;
      ENTITY_CACHE.set(raw, out);
    }
    return out;
  }

  // The decorations of the document, or, given a `region` of whole lines
  // that holds whole top-level blocks, those of that stretch alone, as the
  // ranges to put in place of the ones standing there (rebuilt, below).
  function buildDecorations(state, region) {
    const doc = state.doc;
    const ranges = activeRanges(state);
    // What the host kept back, which every number counts from (hiddenLines).
    const hidden = state.field(hiddenLinesField, false) || 0;
    const tree = CM.syntaxTree(state);
    const decos = [];
    const lines = lineClassCollector(doc);
    const touched = function (from, to) {
      return touchedBy(ranges, from, to);
    };
    // ---- The frame a line stands in ----
    //
    // A line inside a quote or a callout is drawn inside it: a bar for every
    // level, outermost first, the tint of the innermost callout, and the
    // text set in past the bars. The levels are gathered here as the walk
    // enters the container nodes (one level per node, so nesting is depth)
    // and emitted at the end as the line's classes and a style holding the
    // bars and the inset (style.css, .mdm-framed); a block drawn instead of
    // its source takes the frame of its first line on a wrapper (framed).
    // Until this a container was one class on the line whatever the depth,
    // so three nested quotes drew as one bar, a quote in a callout showed
    // the callout's bar alone, and a block in a quote stood outside it
    // (G030, G032).
    const frames = new Map(); // line number -> levels, outermost first
    const frameLevel = function (from, to, level) {
      const first = doc.lineAt(from).number;
      const last = doc.lineAt(Math.max(from, to)).number;
      for (let n = first; n <= last; n++) {
        let levels = frames.get(n);
        if (!levels) frames.set(n, (levels = []));
        levels.push(level);
      }
    };
    // The bars and the inset of a set of levels as CSS. A quote or a callout
    // is a 3 px bar and 14 px of air, the 17 the quote has always drawn; a
    // list item is 1.5em of hanging indent with no bar, the measure the
    // page's lists take (mdm-look.css). Nested levels come out as nested
    // bars and the inset is their sum, pixels and ems together. One
    // gradient for all the bars, because a line is one element and a border
    // draws one bar; the inset itself is a transparent border on the line,
    // so the padding of a card or a heading inside a frame stays its own.
    const FRAME_STEP = 17;
    const FRAME_BAR = 3;
    const LIST_STEP = 1.5;
    const frameCache = new Map();
    const at = function (px, em) {
      if (!em) return px + "px";
      return px ? "calc(" + px + "px + " + em + "em)" : em + "em";
    };
    const buildFrame = function (levels, key, n) {
      const parts = [];
      let px = 0;
      let em = 0;
      let endPx = 0;
      let endEm = 0;
      let quotes = 0;
      let callout = null;
      let item = false;
      let marker = null;
      levels.forEach(function (level) {
        if (level.kind === "list") {
          em += LIST_STEP;
          item = true;
          if (level.first === n) marker = level.marker;
          return;
        }
        const color =
          level.kind === "quote" ? "var(--mdm-quote-bar)" : "var(--mdm-co-" + level.name + ")";
        if (px > endPx || em > endEm) parts.push("transparent " + at(endPx, endEm) + " " + at(px, em));
        parts.push(color + " " + at(px, em) + " " + at(px + FRAME_BAR, em));
        endPx = px + FRAME_BAR;
        endEm = em;
        px += FRAME_STEP;
        if (level.kind === "quote") quotes++;
        else callout = level.name;
      });
      parts.push("transparent " + at(endPx, endEm));
      let cls = "mdm-framed";
      if (quotes) cls += " mdm-quote mdm-quote-" + Math.min(quotes, 4);
      if (callout) cls += " mdm-co-line mdm-co--" + callout;
      if (item) cls += " mdm-li";
      const bars = parts.length > 1 ? "linear-gradient(to right, " + parts.join(", ") + ")" : "none";
      return {
        key: key,
        cls: cls,
        marker: marker,
        style: "--mdm-bars: " + bars + "; --mdm-inset: " + at(px, em),
      };
    };
    // The prefix a line carries for the containers around it, level by
    // level, outermost first: a quote takes its > and the space after it,
    // an item its indentation up to the item's width (on the lines after
    // the one its marker is on). `onIndent` is told each run of an item's
    // indentation; the end of the whole prefix is returned.
    const walkPrefix = function (n, line, onIndent) {
      const levels = frames.get(n);
      if (!levels) return 0;
      let pos = 0;
      levels.forEach(function (level) {
        if (level.kind === "quote") {
          const m = /^[ \t]*>[ \t]?/.exec(line.text.slice(pos));
          if (m) pos += m[0].length;
          return;
        }
        if (level.kind !== "list" || level.first === n) return;
        let run = 0;
        while (pos + run < line.length && /[ \t]/.test(line.text[pos + run])) run++;
        const take = Math.min(run, level.width);
        if (take > 0 && onIndent) onIndent(line.from + pos, line.from + pos + take);
        pos += take;
      });
      return pos;
    };
    // The TeX of a display block, without the container it stands in: Lezer
    // hangs the > of a quote inside the content and leaves an item's
    // indentation on every line after the first, and KaTeX was handed both
    // (G033). Each line of the content from past its prefix.
    const blockTex = function (content) {
      const first = doc.lineAt(content.from).number;
      const last = doc.lineAt(content.to).number;
      const out = [];
      for (let n = first; n <= last; n++) {
        const line = doc.line(n);
        const from = Math.max(content.from, line.from + walkPrefix(n, line, null));
        const to = Math.min(content.to, line.to);
        out.push(from < to ? text(from, to) : "");
      }
      return out.join("\n");
    };
    const frameOf = function (n) {
      const levels = frames.get(n);
      if (!levels) return null;
      const key = levels
        .map(function (level) {
          if (level.kind === "quote") return "q";
          if (level.kind === "callout") return "c:" + level.name;
          // The marker only on the item's first line, where a block that
          // replaces the line takes it into its wrapper.
          return level.first === n
            ? "L:" + level.marker.kind + ":" + level.marker.text + (level.marker.checked ? "x" : "")
            : "l";
        })
        .join("/");
      let frame = frameCache.get(key);
      if (!frame) frameCache.set(key, (frame = buildFrame(levels, key, n)));
      return frame;
    };
    const text = function (from, to) {
      return doc.sliceString(from, to);
    };
    // An unstyled mark over the text of a heading. CodeMirror takes its
    // sample of what a line of text measures from the first line in view of
    // twenty characters or fewer whose children are plain text
    // (measureTextSize), and a short heading qualified: with a setext
    // heading first in view the sample was 62 px tall, every line not yet
    // measured was estimated at that, the view jumped when the map was put
    // right and ArrowDown stepped over blank rows (G099). A mark makes the
    // heading's text a child of another kind, and the sample is prose.
    const sampleProof = function (from, to) {
      if (to > from) decos.push(Decoration.mark({ class: "mdm-h-text" }).range(from, to));
    };
    const hide = function (from, to) {
      if (to > from) decos.push(Decoration.replace({}).range(from, to));
    };
    // ---- Links and the definitions they may point to ----
    //
    // The definitions of the document, so a link or an image written by
    // reference (`[text][label]`, `[label][]`, `[label]`) knows where it
    // goes and what it shows (G004, G007).
    const refs = definitionsOf(state, tree);
    // The delimiters of code and of maths, in the brass the line numbers are
    // drawn in: the backticks of a fence and of inline code, and the $ and $$
    // around an equation. They are the document's punctuation and not its
    // words, which is what a number in the margin is as well, and the grey of
    // the other marks (.mdm-mark, on every mark Lezer tags as a processing
    // instruction) said as much about a backtick as about a * or a #.
    const delim = function (node, kind) {
      node.getChildren(kind).forEach(function (m) {
        if (m.to > m.from) decos.push(Decoration.mark({ class: "mdm-delim" }).range(m.from, m.to));
      });
    };
    // Whole lines taken out of the flow. Block replace decorations cover whole
    // lines, and there are two kinds of cover: over a block that is drawn
    // instead of its source (a score, an equation, a table), which carries the
    // number of the block's first line since every line under it is gone; and
    // over lines a block keeps back while the rest of it stays on screen (the
    // fences of a code block, the `===` under a Setext heading), where the
    // lines still showing carry the numbering themselves and a number here
    // would land on top of theirs.
    const cover = function (from, to, widget) {
      const a = doc.lineAt(from).from;
      const b = doc.lineAt(to).to;
      const spec = widget ? { block: true, widget: widget } : { block: true };
      decos.push(Decoration.replace(spec).range(a, b));
    };
    const hideLines = function (from, to) {
      cover(from, to, null);
    };
    const hideBlock = function (from, to) {
      cover(from, to, new BlockCoverWidget(doc.lineAt(from).number + hidden));
    };
    // The mark plus the single space after it, the way `# `, `> ` and `- `
    // are written, or the tab that stands for it (`>\tquote`, G041).
    const markWithSpace = function (node) {
      const to = node.to < doc.length && /[ \t]/.test(text(node.to, node.to + 1)) ? node.to + 1 : node.to;
      return { from: node.from, to: to };
    };
    // The whitespace a reader drops from the head of a line of prose or of a
    // heading: what stands between the prefix of the line's containers and
    // its text (CommonMark 4.8, a paragraph's lines are stripped of their
    // initial whitespace; 4.2, up to three spaces before a heading's #).
    // Drawn, it set the text in where the page sets it flush (G041). Hidden
    // while the line is untouched, and on the first line of a block only
    // when it runs up to `first`, the block's first character: the
    // indentation of an item's marker is the marker widget's, and is never
    // hidden twice.
    const hideLead = function (n, first) {
      const line = doc.line(n);
      if (touched(line.from, line.to)) return;
      const from = line.from + walkPrefix(n, line, null);
      let to = from;
      while (to < line.to && /[ \t]/.test(text(to, to + 1))) to++;
      if (to > from && (first == null || to === first)) hide(from, to);
    };
    // The columns of indentation that make a line code (four, or a tab), and
    // the ones a body line shares with its indented fence: the page prints
    // the code without them. `cols` of them go, past the containers' prefix.
    const hideIndent = function (n, cols) {
      const line = doc.line(n);
      const from = line.from + walkPrefix(n, line, null);
      let to = from;
      let taken = 0;
      while (to < line.to && taken < cols) {
        const ch = text(to, to + 1);
        if (ch === " ") taken++;
        else if (ch === "\t") taken = cols;
        else break;
        to++;
      }
      if (to > from) hide(from, to);
    };

    // The tail paragraphs of hidden maths blocks (see BlockMath below).
    const hiddenTails = new Set();

    tree.iterate({
      from: region ? region.from : 0,
      to: region ? region.to : doc.length,
      enter: function (n) {
        const name = n.name;
        const node = n.node;

        if (name === "Paragraph" && hiddenTails.has(n.from)) return false;

        // A paragraph, and the paragraph of a task item, drawn with the
        // punctuation the page prints (G015, above).
        if (name === "Paragraph" || name === "Task") {
          smartWidgets(node, n.to, text, doc, touched, decos);
          // A note's paragraphs have their indentation hidden by the note.
          if (!node.parent || node.parent.name !== "FootnoteDef") {
            const head = doc.lineAt(n.from).number;
            const tail = doc.lineAt(n.to).number;
            for (let k = head; k <= tail; k++) hideLead(k, k === head ? n.from : null);
          }
          return true;
        }

        if (name === "FrontMatter") {
          lines.add(n.from, n.to, "mdm-fm-line");
          lines.card(n.from, n.to);
          lines.add(n.from, n.from, "mdm-fm-first");
          lines.add(n.to, n.to, "mdm-fm-last");
          node.getChildren("FrontMatterMark").forEach(function (m) {
            lines.add(m.from, m.to, "mdm-fm-mark");
          });
          return false;
        }

        if (name === "FencedCode") {
          const marks = node.getChildren("CodeMark");
          const info = node.getChild("CodeInfo");
          const body = fenceBody(node);
          const infoText = info ? text(info.from, info.to) : "";
          const source = fenceSource(doc, node);
          const openLine = doc.lineAt(n.from);
          // The > of a quote the fence stands in: Lezer hangs them under the
          // fence, where the walk never goes (this branch returns false), so
          // they were drawn on the card's lines (G033).
          node.getChildren("QuoteMark").forEach(function (m) {
            const line = doc.lineAt(m.from);
            if (!touched(line.from, line.to)) {
              const r = markWithSpace(m);
              hide(r.from, r.to);
            }
          });
          // The line the closing fence is on, which the decorations below hide
          // and mark; where the block ENDS is scoreEnd, the one definition the
          // export's count of the document's scores reads as well.
          const closeLine = marks.length > 1 ? doc.lineAt(marks[1].from) : null;
          const blockFrom = openLine.from;
          const blockTo = scoreEnd(doc, node, n.to);
          const open = touched(blockFrom, blockTo);
          const active = open && holdsMainHead(state, blockFrom, blockTo);
          if (open) delim(node, "CodeMark");
          if (isAbcInfo(infoText)) {
            decos.push(
              Decoration.widget({
                widget: new ScoreWidget(source, active, open, frameOf(openLine.number)),
                block: true,
                side: 1,
              }).range(blockTo)
            );
            if (!open) {
              hideBlock(blockFrom, blockTo);
              return false;
            }
            // mdm-abc-line: the source of a score is the one code whose
            // colours the extension owns, the plumbing between the notes
            // (slurs, ties, the brackets of a chord) included, so it carries
            // a class of its own and no theme ink reaches it.
            lines.add(blockFrom, blockTo, "mdm-code-line mdm-src-line mdm-abc-line");
            lines.card(blockFrom, blockTo);
            lines.add(openLine.from, openLine.from, "mdm-code-first mdm-fence-line");
            if (closeLine) lines.add(closeLine.from, closeLine.from, "mdm-code-last mdm-fence-line");
            // The word on the fence that says this block is a score, in the
            // brass the notes are drawn in: the info string is Markdown, so
            // the ABC mode never sees it and it took the grey of the marks.
            if (info) {
              decos.push(
                Decoration.mark({ class: "mdm-fence-info" }).range(info.from, info.to)
              );
            }
            return false;
          }
          // The chrome rides the top line of the card as an inline widget of
          // no size: the fence while it shows, the first line of code while
          // it is hidden (a block widget at the fence would go with the fence
          // when that line is hidden). The top line so that the rail stands
          // level with the top of the card either way. At the fence's own
          // backticks and not the start of its line, which in a list or a
          // quote is not inside the block, and chromeSource finds the block
          // from where the chrome stands.
          decos.push(
            Decoration.widget({
              widget: new CodeChromeWidget(active, open),
              side: -1,
            }).range(open ? n.from : body ? body.from : openLine.to)
          );
          lines.add(blockFrom, blockTo, "mdm-code-line");
          lines.card(blockFrom, blockTo);
          if (open) {
            lines.add(openLine.from, openLine.from, "mdm-code-first mdm-fence-line");
            if (closeLine) lines.add(closeLine.from, closeLine.from, "mdm-code-last mdm-fence-line");
            // The word that names the language, in the same brass the `abc` of
            // a score fence takes: it is the one thing on that line that says
            // what the block is, and the grey of the marks around it said as
            // much about it as about the backticks.
            if (info) {
              decos.push(
                Decoration.mark({ class: "mdm-fence-info" }).range(info.from, info.to)
              );
            }
          } else if (!body) {
            cover(openLine.from, closeLine ? closeLine.to : openLine.to, new EmptyCardWidget(openLine.number + hidden, frameOf(openLine.number)));
          } else {
            hideLines(openLine.from, openLine.to);
            if (closeLine) hideLines(closeLine.from, closeLine.to);
            lines.add(body.from, body.from, "mdm-code-first");
            lines.add(body.to, body.to, "mdm-code-last");
            // A fence set in one to three spaces takes as many off each line
            // of its body (CommonMark 4.5), and so does the page (G041). The
            // fence's own indentation: past the containers' prefix, and past
            // the marker of an item the fence opens on the line of.
            let inset = walkPrefix(openLine.number, openLine, null);
            (frames.get(openLine.number) || []).forEach(function (level) {
              if (level.kind === "list" && level.first === openLine.number) inset = Math.max(inset, level.col);
            });
            const fenceIndent = n.from - openLine.from - inset;
            if (fenceIndent > 0) {
              const lastBody = doc.lineAt(body.to).number;
              for (let k = doc.lineAt(body.from).number; k <= lastBody; k++) hideIndent(k, fenceIndent);
            }
            // A fence opened on the line of a list item: the line goes with
            // the fence, and the item's marker is drawn in the gap beside
            // the card's first line instead (G029).
            const frame = frameOf(openLine.number);
            if (frame && frame.marker) {
              decos.push(
                Decoration.widget({
                  widget: new MarkerWidget(frame.marker.kind, frame.marker.text, frame.marker.checked, true),
                  side: -1,
                }).range(body.from)
              );
            }
          }
          return false;
        }

        if (name === "CodeBlock") {
          // Indented code: no fences to hide, the card alone.
          lines.add(n.from, n.to, "mdm-code-line");
          lines.card(n.from, n.to);
          lines.add(n.from, n.from, "mdm-code-first");
          lines.add(n.to, n.to, "mdm-code-last");
          // The four columns that make the lines code, put away while the
          // caret is out of the block and back for all its lines at once
          // when it comes in, so the code never stands at two insets (G041).
          if (!touched(doc.lineAt(n.from).from, n.to)) {
            for (let k = doc.lineAt(n.from).number; k <= doc.lineAt(n.to).number; k++) hideIndent(k, 4);
          }
          return false;
        }

        if (name === "BlockMath") {
          const content = node.getChild("BlockMathContent");
          const tex = content ? blockTex(content) : "";
          const blockFrom = doc.lineAt(n.from).from;
          const blockTo = doc.lineAt(n.to).to;
          const out = renderTex(tex, true);
          const open = touched(blockFrom, blockTo);
          const active = open && holdsMainHead(state, blockFrom, blockTo);
          // The rest of the closing line past its `$$`, a paragraph of its
          // own on that line (math.js), drawn under the equation by the
          // widget while the block is hidden (see MathWidget).
          const next = node.nextSibling;
          const tailNode = next && next.name === "Paragraph" && next.from < blockTo ? next : null;
          let tail = tailNode ? { key: text(tailNode.from, tailNode.to), parts: cellParts(tailNode, text, null, smartMarks(tailNode, tailNode.to, text), refs) } : null;
          // A label alone after the closer (`$$ {#eq-mass}`) is an attribute
          // the page prints none of: nothing is drawn under the equation.
          if (tail && !partsText(tail.parts).trim()) tail = null;
          if (open || out.html) {
            decos.push(
              Decoration.widget({
                widget: new MathWidget(
                  tex, true, true, false, active, open, frameOf(doc.lineAt(blockFrom).number), tail
                ),
                block: true,
                side: 1,
              }).range(blockTo)
            );
          }
          if (!open && out.html) {
            hideBlock(blockFrom, blockTo);
            // The tail is the widget's: its own marks are not wanted under
            // the cover.
            if (tailNode) hiddenTails.add(tailNode.from);
            return false;
          }
          delim(node, "BlockMathMark");
          lines.add(blockFrom, blockTo, "mdm-math-line mdm-src-line" + (out.html ? "" : " mdm-math--broken"));
          lines.card(blockFrom, blockTo);
          lines.add(blockFrom, blockFrom, "mdm-math-first");
          lines.add(blockTo, blockTo, "mdm-math-last");
          return false;
        }

        if (name === "InlineMath" || name === "InlineBlockMath") {
          const display = name === "InlineBlockMath";
          const content = node.getChild(display ? "InlineBlockMathContent" : "InlineMathContent");
          const tex = content ? text(content.from, content.to) : "";
          const out = renderTex(tex, display);
          if (!touched(n.from, n.to) && out.html) {
            decos.push(
              Decoration.replace({ widget: new MathWidget(tex, display, false) }).range(n.from, n.to)
            );
          } else {
            decos.push(
              Decoration.mark({ class: "mdm-math-src" + (out.html ? "" : " mdm-math--broken") }).range(n.from, n.to)
            );
            delim(node, display ? "InlineBlockMathMark" : "InlineMathMark");
            // Editing it: the source stays and, once the LaTeX compiles, the
            // rendered equation appears just after the closing delimiter as a
            // live preview. While it does not compile there is nothing to draw
            // and the source stands alone.
            if (out.html) {
              decos.push(
                Decoration.widget({
                  widget: new MathWidget(tex, display, false, true),
                  side: 1,
                }).range(n.to)
              );
            }
          }
          return false;
        }

        if (name === "Callout") {
          const marks = node.getChildren("CalloutMark");
          // The kind of a Quarto callout, or null for any other fenced div
          // (`::: {.column}`, `::: {#refs}`), which the page prints bare:
          // no bar and no tint for those, the fences alone put away (G051).
          const kind = marks.length ? CM.calloutKind(text(marks[0].from, marks[0].to)) : null;
          if (kind) {
            frameLevel(n.from, n.to, { kind: "callout", name: kind });
            lines.mark(n.from, n.from, "mdm-co-first");
            lines.mark(n.to, n.to, "mdm-co-last");
          }
          marks.forEach(function (m) {
            const line = doc.lineAt(m.from);
            if (!touched(line.from, line.to)) {
              lines.mark(m.from, m.from, "mdm-co-fence");
              // The fading goes on the fence's text and not on the row: an
              // opacity on the row faded its bar and its number with it,
              // and the bar arrived in three bands (G096).
              if (m.to > m.from) {
                decos.push(Decoration.mark({ class: "mdm-co-fence-text" }).range(m.from, m.to));
              }
            }
          });
          return true;
        }

        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = name.slice(-1);
          lines.add(n.from, n.to, "mdm-h mdm-h" + level + " mdm-h-first mdm-h-last");
          sampleProof(n.from, n.to);
          // From the head of the line: a caret in the spaces before the #
          // opens the heading as one in its text does (G041).
          if (!touched(doc.lineAt(n.from).from, n.to)) {
            hideLead(doc.lineAt(n.from).number, n.from);
            node.getChildren("HeaderMark").forEach(function (m) {
              const r = markWithSpace(m);
              // The opening run: every space and tab after it goes with it,
              // since the heading's text starts past them (CM 4.2; `#\t`
              // and `# \t` are headings, G042).
              let to = r.to;
              if (m.from === n.from) while (to < n.to && /[ \t]/.test(text(to, to + 1))) to++;
              // A closing run of #: the space before it goes too.
              const from = m.from > n.from && text(m.from - 1, m.from) === " " ? m.from - 1 : r.from;
              hide(from, to);
            });
            // Pandoc's header attributes go, with the space before them.
            const textEnd = headingTextEnd(n, text);
            if (textEnd < n.to) hide(textEnd, n.to);
            smartWidgets(node, textEnd, text, doc, touched, decos);
          }
          return true;
        }

        if (/^SetextHeading[12]$/.test(name)) {
          const level = name.slice(-1);
          const mark = node.getChild("HeaderMark");
          // The last line of the text is the one over the underline's line,
          // not the one holding the character before the mark: an underline
          // set in a space or two has them before it on its own line, and the
          // rule of the heading went to that hidden row.
          const lastText = mark ? doc.line(doc.lineAt(mark.from).number - 1) : doc.lineAt(n.to);
          lines.add(n.from, lastText.to, "mdm-h mdm-h" + level);
          sampleProof(n.from, lastText.to);
          // A heading written over several lines is one heading: the air
          // above goes on the first line and the rule under the last, where
          // every line of it used to draw both (G049).
          lines.add(n.from, n.from, "mdm-h-first");
          lines.add(lastText.from, lastText.from, "mdm-h-last");
          if (mark) {
            if (!touched(n.from, n.to)) hideLines(mark.from, mark.to);
            else {
              lines.add(mark.from, mark.to, "mdm-mark-line");
              sampleProof(mark.from, mark.to);
            }
          }
          smartWidgets(node, n.to, text, doc, touched, decos);
          for (let k = doc.lineAt(n.from).number; k <= lastText.number; k++) {
            hideLead(k, k === doc.lineAt(n.from).number ? n.from : null);
          }
          return true;
        }

        if (name === "Blockquote") {
          frameLevel(n.from, n.to, { kind: "quote" });
          return true;
        }

        // The > of every quoted line, wherever the tree hangs it (the first
        // under the Blockquote, the continuation lines under the paragraph
        // inside): hidden unless a caret is on that line.
        if (name === "QuoteMark") {
          const line = doc.lineAt(n.from);
          if (!touched(line.from, line.to)) {
            const r = markWithSpace(node);
            hide(r.from, r.to);
          }
          return false;
        }

        if (name === "ListItem") {
          const mark = node.getChild("ListMark");
          if (!mark) return true;
          const line = doc.lineAt(mark.from);
          const markText = text(mark.from, mark.to);
          const ordered = node.parent.name === "OrderedList";
          // The content column of the item: the marker and the spaces after
          // it, one when there are five or more or none (CommonMark 5.2).
          let after = 0;
          while (mark.to + after < line.to && text(mark.to + after, mark.to + after + 1) === " ") after++;
          if (after === 0 || after > 4) after = 1;
          const col = mark.to - line.from + after;
          // The item's own indentation: the spaces before its marker, up to
          // the one a quote mark keeps for itself.
          let from = mark.from;
          while (
            from > line.from &&
            /[ \t]/.test(text(from - 1, from)) &&
            !(from - 1 > line.from && text(from - 2, from - 1) === ">")
          ) {
            from--;
          }
          // The number the list gives the item: its start and its place.
          let index = 0;
          for (let s = node.prevSibling; s; s = s.prevSibling) {
            if (s.name === "ListItem") index++;
          }
          const task = node.getChild("Task");
          const box = task && task.getChild("TaskMarker");
          let marker;
          if (box) {
            marker = { kind: "task", text: "", checked: /x/i.test(text(box.from, box.to)) };
          } else if (ordered) {
            const head = node.parent.firstChild && node.parent.firstChild.getChild("ListMark");
            const start = head ? parseInt(text(head.from, head.to), 10) : 1;
            marker = { kind: "number", text: String((isNaN(start) ? 1 : start) + index) + markText.slice(-1) };
          } else {
            marker = { kind: "bullet", text: "•" };
          }
          frameLevel(n.from, n.to, {
            kind: "list",
            col: col,
            width: line.from + col - from,
            first: line.number,
            marker: marker,
          });
          if (!touched(line.from, line.to)) {
            // The marker as typed, its indentation and the space after it
            // (for a task, its box and the space after that), replaced by
            // the drawn marker in the hanging gap; the line hangs its first
            // row back by the gap (style.css, .mdm-li-first).
            const to = box
              ? box.to < line.to && text(box.to, box.to + 1) === " "
                ? box.to + 1
                : box.to
              : line.from + col;
            decos.push(
              Decoration.replace({
                widget: new MarkerWidget(marker.kind, marker.text, marker.checked),
              }).range(from, to)
            );
            lines.mark(line.from, line.from, "mdm-li-first");
          }
          return true;
        }

        if (name === "HorizontalRule") {
          const line = doc.lineAt(n.from);
          if (!touched(line.from, line.to)) {
            decos.push(
              Decoration.replace({
                widget: new RuleWidget(line.number + hidden, frameOf(line.number)),
                block: true,
              }).range(line.from, line.to)
            );
          } else {
            lines.add(n.from, n.to, "mdm-mark-line");
          }
          return false;
        }

        if (name === "Table") {
          const blockFrom = doc.lineAt(n.from).from;
          const blockTo = doc.lineAt(n.to).to;
          decos.push(
            Decoration.widget({
              widget: new TableWidget(
                text(blockFrom, blockTo),
                tableModel(node, text, refs),
                frameOf(doc.lineAt(blockFrom).number)
              ),
              block: true,
              side: 1,
            }).range(blockTo)
          );
          if (!touched(blockFrom, blockTo)) {
            hideBlock(blockFrom, blockTo);
            return false;
          }
          // Open for editing: the pipes as they were typed, in a monospace
          // grid so the columns line up under each other, with the drawn
          // table below as the live preview. The cells keep their source,
          // equations included: a rendered `$i$` in a column would move the
          // pipe the row below is being aligned against.
          lines.add(blockFrom, blockTo, "mdm-table-line mdm-src-line");
          return false;
        }

        if (RAW_HTML_BLOCK.test(name)) {
          lines.add(n.from, n.to, "mdm-html-line");
          return false;
        }

        if (name === "LinkReference") {
          // A definition is not prose: drawn like an HTML block, small and
          // faint, and left as written (G025).
          lines.add(n.from, n.to, "mdm-linkref-line");
          return false;
        }

        if (name === "Link") {
          const target = linkTarget(node, text, refs);
          const attributes = {};
          // The tooltip is the destination, what a hover shows anywhere;
          // the Markdown title, when there is one, rides beside it.
          if (target && target.url) attributes.title = target.url;
          if (target && target.title) attributes["data-mdm-title"] = target.title;
          decos.push(
            Decoration.mark({
              class: "mdm-link",
              attributes: target ? attributes : undefined,
            }).range(n.from, n.to)
          );
          if (!touched(n.from, n.to)) {
            // The opening bracket, and everything from the closing bracket
            // to the end of the link: the destination and title with the
            // parentheses and whatever space was typed around them (G024),
            // or the label in its brackets. The text between stays.
            const marks = node.getChildren("LinkMark");
            if (marks.length) hide(marks[0].from, marks[0].to);
            if (marks.length > 1) hide(marks[1].from, n.to);
          }
          return true;
        }

        if (name === "Autolink" || name === "URL") {
          // A bare address is a link when it has a scheme or is a mail
          // address, which is what the page links (Pandoc's
          // autolink_bare_uris, the export's reader, measured on 3.8.3); a
          // `www.` address, which GFM links too, is text on the page and so
          // is text here (G017). An address in angle brackets is a link
          // either way.
          if (name === "URL" && !/^[a-z][a-z0-9+.-]*:|@/i.test(text(n.from, n.to))) return false;
          decos.push(Decoration.mark({ class: "mdm-link" }).range(n.from, n.to));
          if (name === "Autolink" && !touched(n.from, n.to)) {
            node.getChildren("LinkMark").forEach(function (m) {
              hide(m.from, m.to);
            });
          }
          return false;
        }

        if (name === "Image") {
          const target = linkTarget(node, text, refs);
          const src = target && target.url ? imageSource(target.url) : null;
          // The attribute block after the image, `{#fig-x width=30%}`: its
          // width is the picture's, and it is part of the figure's paragraph.
          const attr = node.nextSibling && node.nextSibling.name === "Attribute" ? node.nextSibling : null;
          const width = attr ? cssLength(attributeValue(text(attr.from, attr.to), "width")) : null;
          if (src && !touched(n.from, n.to)) {
            const marks = node.getChildren("LinkMark");
            // The alt is the figure's caption and the picture's own text,
            // and the page prints both with their punctuation set (G015)
            // and with their marks read: it is inline content, drawn by the
            // same reader a table's cell is drawn by. The source between
            // the brackets is what tells two figures apart.
            const caption = cellParts(node, text, LINK_SKIP, smartMarks(node, marks.length > 1 ? marks[1].from : n.to, text), refs);
            const alt = partsText(caption);
            const key = marks.length > 1 ? text(marks[0].to, marks[1].from) : "";
            // Alone in its paragraph, the image is a figure with the alt as
            // its caption, drawn in place of the paragraph.
            const para = node.parent;
            if (
              para &&
              para.name === "Paragraph" &&
              para.from === doc.lineAt(para.from).from &&
              isBlank(text(para.from, n.from)) &&
              isBlank(text(attr ? attr.to : n.to, para.to)) &&
              !touched(para.from, para.to)
            ) {
              const blockFrom = doc.lineAt(para.from).from;
              const blockTo = doc.lineAt(para.to).to;
              decos.push(
                Decoration.widget({
                  widget: new FigureWidget(src, caption, key, frameOf(doc.lineAt(blockFrom).number), width),
                  block: true,
                  side: 1,
                }).range(blockTo)
              );
              hideBlock(blockFrom, blockTo);
              return false;
            }
            decos.push(Decoration.replace({ widget: new ImageWidget(src, alt, width) }).range(n.from, n.to));
            return false;
          }
          return true;
        }

        if (name === "RawTeX" || name === "RawTeXBlock") {
          // Raw TeX (G013): what Pandoc's reader takes as a raw inline or
          // block, which the HTML page leaves out and the PDF sets. Drawn
          // as the source it is, faint and in the code face, with what
          // becomes of it in the tooltip, where the prose used to show it
          // as words the page then lost.
          if (name === "RawTeXBlock") lines.add(n.from, n.to, "mdm-rawtex-line");
          decos.push(
            Decoration.mark({
              class: "mdm-rawtex",
              attributes: { title: "Raw TeX: set in the PDF, left out of the HTML page" },
            }).range(n.from, n.to)
          );
          return false;
        }

        if (name === "Attribute") {
          // `{#id .class key=val}` after a link, an image, a code span or a
          // `$$` closer (G014): hidden while untouched, since the page
          // prints none of it, and small and faint under the caret.
          if (!touched(n.from, n.to)) hide(n.from, n.to);
          else decos.push(Decoration.mark({ class: "mdm-attr" }).range(n.from, n.to));
          return false;
        }

        if (name === "Span") {
          // `[text]{.smallcaps}`, Pandoc's bracketed span: the brackets and
          // the attribute hidden, and the classes the page turns into a
          // look drawn here the same way (small caps; a mark).
          const attr = node.getChild("Attribute");
          const classes = attr ? attributeClasses(text(attr.from, attr.to)) : [];
          let cls = "mdm-span";
          if (classes.indexOf("smallcaps") >= 0) cls += " mdm-smallcaps";
          // The page writes `<u>`, which the browser underlines, so an
          // underline the editor did not draw was a difference between the
          // two surfaces and not a gap (measured on Pandoc 3.8.3). The button
          // that wrote it was taken off again on 2026-09-19; this stays,
          // because the span is still Pandoc's and a document that carries
          // one has to read here as it reads on the page.
          if (classes.indexOf("underline") >= 0) cls += " mdm-underline";
          // Not `mdm-mark`, which is the class of a syntax mark.
          if (classes.indexOf("mark") >= 0) cls += " mdm-highlight";
          decos.push(
            Decoration.mark({
              class: cls,
              attributes: attr ? { title: text(attr.from, attr.to) } : undefined,
            }).range(n.from, n.to)
          );
          if (!touched(n.from, n.to)) {
            node.getChildren("LinkMark").forEach(function (m) {
              hide(m.from, m.to);
            });
          }
          return true;
        }

        if (name === "FootnoteRef") {
          // `[^1]` (PX01): the label raised, as the page raises the number
          // it gives the note, the marks hidden.
          const marks = node.getChildren("FootnoteMark");
          const label = marks.length > 1 ? text(marks[0].to, marks[1].from) : text(n.from, n.to);
          decos.push(
            Decoration.mark({ class: "mdm-note-ref mdm-sup", attributes: { title: "Footnote " + label } }).range(n.from, n.to)
          );
          if (!touched(n.from, n.to)) {
            marks.forEach(function (m) {
              hide(m.from, m.to);
            });
          }
          return false;
        }

        if (name === "FootnoteInline") {
          // `^[text]`: the note's text drawn where it stands, in a small
          // card, its marks hidden; the page numbers it and sets it at the
          // foot.
          decos.push(
            Decoration.mark({ class: "mdm-note-inline", attributes: { title: "Footnote, written inline" } }).range(n.from, n.to)
          );
          if (!touched(n.from, n.to)) {
            node.getChildren("FootnoteMark").forEach(function (m) {
              hide(m.from, m.to);
            });
          }
          return true;
        }

        if (name === "FootnoteDef") {
          // `[^1]: text` and the paragraphs indented under it: the note
          // itself, drawn faint under the prose face, its label raised in
          // place of the `[^1]:` and the indentation of its later
          // paragraphs hidden, while untouched.
          // Line by line, the blank lines between its paragraphs left to
          // the blank row they are.
          for (let k = doc.lineAt(n.from).number, last = doc.lineAt(n.to).number; k <= last; k++) {
            const line = doc.line(k);
            if (!isBlank(line.text)) lines.add(line.from, line.from, "mdm-note-line");
          }
          const mark = node.getChild("FootnoteMark");
          if (mark) {
            if (!touched(n.from, n.to)) {
              const label = text(mark.from + 2, mark.to - 2);
              decos.push(Decoration.replace({ widget: new TextWidget(label, "mdm-note-ref mdm-sup") }).range(mark.from, mark.to));
              node.getChildren("Paragraph").forEach(function (p, i) {
                if (i === 0) return;
                const last = doc.lineAt(p.to).number;
                for (let k = doc.lineAt(p.from).number; k <= last; k++) {
                  const line = doc.line(k);
                  const indent = /^(?: {4}|\t)/.exec(line.text);
                  if (indent) hide(line.from, line.from + indent[0].length);
                }
              });
            } else {
              decos.push(Decoration.mark({ class: "mdm-note-ref" }).range(mark.from, mark.to));
            }
          }
          return true;
        }

        if (name === "Citation") {
          // A citation or a Quarto cross-reference (PX04): the page
          // resolves it into a reference or a link, which the editor cannot
          // (the bibliography is not here); it is drawn in the link colour,
          // as written, with what it is in the tooltip.
          const raw = text(n.from, n.to);
          decos.push(
            Decoration.mark({
              class: "mdm-cite",
              attributes: { title: (raw.charAt(0) === "[" ? "Citation " : "Reference ") + raw },
            }).range(n.from, n.to)
          );
          return false;
        }

        if (name === "Escape") {
          // `\*`: the backslash is markup and the character is text (CM 2.4).
          // The highlighter greys the pair (tags.escape); the character
          // takes the ink back, and the backslash goes while the node is
          // untouched (G008).
          decos.push(Decoration.mark({ class: "mdm-escaped" }).range(n.from + 1, n.to));
          if (!touched(n.from, n.to)) hide(n.from, n.from + 1);
          return false;
        }

        if (name === "Entity") {
          // `&copy;` drawn as ©, `&#35;` as #, while untouched; one that
          // stands for nothing stays as written. Either way in the ink and
          // not in the string colour the highlighter gives it (G009, G010).
          const raw = text(n.from, n.to);
          const decoded = decodeEntity(raw);
          if (decoded !== raw && !touched(n.from, n.to)) {
            decos.push(Decoration.replace({ widget: new TextWidget(decoded, "mdm-entity") }).range(n.from, n.to));
          } else {
            decos.push(Decoration.mark({ class: "mdm-entity" }).range(n.from, n.to));
          }
          return false;
        }

        if (name === "HardBreak") {
          // The node runs to the line end, newline included; the mark before
          // it (the backslash, the spaces) is what is drawn as ↵.
          const line = doc.lineAt(n.from);
          const to = Math.min(n.to, line.to);
          if (!touched(line.from, line.to) && to > n.from) {
            decos.push(Decoration.replace({ widget: HARD_BREAK }).range(n.from, to));
          }
          return false;
        }

        const marks = INLINE_MARKS[name];
        if (marks) {
          if (name === "InlineCode") {
            decos.push(Decoration.mark({ class: "mdm-inline-code" }).range(n.from, n.to));
            if (touched(n.from, n.to)) {
              delim(node, "CodeMark");
            } else {
              // A code span that begins and ends with a space, and is not
              // spaces alone, loses one from each end (CM 6.1): the chip is
              // drawn as the reader sees it, `` ` `` no wider than it (G021).
              const ticks = node.getChildren("CodeMark");
              if (ticks.length > 1) {
                const a = ticks[0].to;
                const b = ticks[1].from;
                const inner = text(a, b);
                if (
                  inner.length > 2 &&
                  inner.charAt(0) === " " &&
                  inner.charAt(inner.length - 1) === " " &&
                  inner.trim().length
                ) {
                  hide(a, a + 1);
                  hide(b - 1, b);
                }
              }
            }
          }
          if (!touched(n.from, n.to)) {
            marks.forEach(function (kind) {
              node.getChildren(kind).forEach(function (m) {
                hide(m.from, m.to);
              });
            });
            // Pandoc's H~2~O and 2^10^ are lowered and raised, as the page
            // sets them (G001): the text between the marks in a sub or a
            // sup, on Bootstrap's measures (style.css).
            if (name === "Subscript" || name === "Superscript") {
              const pair = node.getChildren(marks[0]);
              if (pair.length > 1 && pair[1].from > pair[0].to) {
                decos.push(
                  Decoration.mark({
                    tagName: name === "Subscript" ? "sub" : "sup",
                    class: name === "Subscript" ? "mdm-sub" : "mdm-sup",
                  }).range(pair[0].to, pair[1].from)
                );
              }
            }
          }
          return true;
        }
        return true;
      },
    });

    // Two things that want a walk of the whole document, taken in one.
    //
    // The gap between two paragraphs is a blank line of Markdown, and drawn
    // at the height of a line of prose it left the paragraphs adrift: the
    // rendered document (Vditor, and the Office Viewer preview with it) puts
    // 16px between two paragraphs of a 16px body, an em, where a line of this
    // editor stands at 1.7 of one. The class is what the stylesheet draws
    // that em from. Only on prose: a blank line inside a fence or the front
    // matter is a line of the block and already carries its class.
    //
    // The number goes on every line of the source, with nothing said here
    // about which of them are on screen. A line the editor has taken out of
    // the flow carries a number that is never drawn: the source of a closed
    // score, equation or table is covered by a block replacement, and a
    // decoration inside one is never reached (the span iterator jumps to the
    // end of the replaced range), so the numbers of a block appear the moment
    // a caret opens it and go again when it closes. The rule that decides
    // what a block shows is the one above; the numbering only follows it.
    frames.forEach(function (levels, n) {
      const frame = frameOf(n);
      const line = doc.line(n);
      lines.mark(line.from, line.from, frame.cls);
      lines.style(n, frame.style);
      // The indentation a line after the first carries inside an item, up
      // to the item's content column, hidden while the line is untouched:
      // the frame sets the text in, and the spaces would set it in twice.
      // Read level by level, outermost first, since the > of a quote and
      // the spaces of an item come in the order of the containers: a quote
      // takes its mark (hidden by the QuoteMark branch), an item its spaces.
      // A line that opens an item is that item's marker's (above).
      if (touched(line.from, line.to)) return;
      walkPrefix(n, line, hide);
    });
    const firstLine = region ? doc.lineAt(region.from).number : 1;
    const lastLine = region ? doc.lineAt(region.to).number : doc.lines;
    for (let n = firstLine; n <= lastLine; n++) {
      const line = doc.line(n);
      // Blank is spaces and tabs alone (CommonMark 2.1; a line of a no-break
      // space is a paragraph), and inside a quote the > marks on their own.
      const blank = frames.has(n) ? /^[ \t>]*$/ : /^[ \t]*$/;
      if (lines.bare(n) && blank.test(line.text)) {
        lines.add(line.from, line.from, "mdm-blank");
      }
      // Under the caret, the characters that draw nothing are named (G058).
      if (touched(line.from, line.to) && SPECIAL_CHAR.test(line.text)) {
        for (let i = 0; i < line.text.length; i++) {
          if (!SPECIAL_CHAR.test(line.text[i])) continue;
          decos.push(
            Decoration.replace({ widget: new SpecialCharWidget(line.text.charCodeAt(i)) }).range(line.from + i, line.from + i + 1)
          );
        }
      }
      decos.push(lineNumber(n + hidden).range(line.from));
    }

    const all = decos.concat(lines.decorations());
    return region ? all : Decoration.set(all, true);
  }

  // ---- Rebuilding no more than what changed ----
  //
  // Every caret move, every keystroke and every piece of the tree that
  // lands used to rebuild the decorations of the whole document: 95 ms on
  // the bench's 22 805-line file (57 of the walk, 12 of the lines, 21 of
  // sorting the set), which is what a keystroke and an arrow key cost there.
  // The decorations of a top-level block depend on its own text and nodes,
  // on the carets that touch it, on the lines the host keeps back and on the
  // document's link definitions, and on nothing else; so the set that stands
  // is kept, moved along with the changes, and only the blocks are rebuilt
  // that a caret touched or touches now, that the change fell in, or that
  // the two trees differ over. The whole document is rebuilt when the number
  // of lines changes (a drawn rule, table or empty card carries its line's
  // number, and every number below moves), when the host keeps another count
  // of lines back, when a link definition is in what changed (a link
  // anywhere may go somewhere else), or when the stretch to rebuild is most
  // of the document anyway.

  // What the set a field holds was built from, and how many sets were built
  // whole and how many in part, which a test reads to know the second road
  // was taken at all.
  const builtFrom = new WeakMap();
  const rebuilds = { whole: 0, part: 0 };
  function remember(set, state) {
    builtFrom.set(set, {
      ranges: activeRanges(state).map(function (r) {
        return { from: r.from, to: r.to };
      }),
      tree: CM.syntaxTree(state),
      hidden: state.field(hiddenLinesField, false) || 0,
      lines: state.doc.lines,
    });
    return set;
  }

  // The stretch from..to as whole lines, grown over the top-level blocks
  // that stand on its first and last line (the prose after a `$$` closer is
  // a block of its own on the closer's line).
  function wholeBlocks(doc, tree, from, to) {
    const top = tree.topNode;
    let a = doc.lineAt(Math.max(0, Math.min(from, doc.length))).from;
    let b = doc.lineAt(Math.max(0, Math.min(to, doc.length))).to;
    for (let i = 0; i < 8; i++) {
      let grew = false;
      const first = top.childAfter(a);
      if (first && first.from < a && first.to >= a) {
        a = doc.lineAt(first.from).from;
        grew = true;
      }
      const last = top.childBefore(b);
      if (last && last.from <= b && last.to > b) {
        b = doc.lineAt(Math.min(last.to, doc.length)).to;
        grew = true;
      }
      if (!grew) break;
    }
    return [a, b];
  }

  // The stretch over which the top-level blocks of two trees differ, as the
  // blocks of the old one and of the new one that match nothing, or null
  // when the two are the same. The blocks before the first change keep their
  // place and the ones after the last move by `delta`.
  function blocksDiffer(before, after, delta) {
    let a = before.topNode.firstChild;
    let b = after.topNode.firstChild;
    while (a && b && a.type.id === b.type.id && a.from === b.from && a.to === b.to) {
      a = a.nextSibling;
      b = b.nextSibling;
    }
    if (!a && !b) return null;
    let x = a ? before.topNode.lastChild : null;
    let y = b ? after.topNode.lastChild : null;
    while (
      x && y && x.from >= a.from && y.from >= b.from &&
      x.type.id === y.type.id && x.from + delta === y.from && x.to + delta === y.to
    ) {
      x = x.prevSibling;
      y = y.prevSibling;
    }
    return {
      old: a && x && x.from >= a.from ? [a.from, x.to] : null,
      now: b && y && y.from >= b.from ? [b.from, y.to] : null,
    };
  }

  function holdsDefinition(tree, from, to) {
    let found = false;
    tree.iterate({
      from: from,
      to: to,
      enter: function (n) {
        if (n.name === "LinkReference") found = true;
        return !found;
      },
    });
    return found;
  }

  // The set for the state a transaction leaves, from the set that stood.
  function rebuilt(value, tr) {
    const state = tr.state;
    const doc = state.doc;
    const tree = CM.syntaxTree(state);
    const built = builtFrom.get(value);
    const hidden = state.field(hiddenLinesField, false) || 0;
    // A reconfigured state is the language taken up again with another set
    // of link definitions (links.js): what is a link changes inside blocks
    // that keep their place and their size, which no comparison of blocks
    // sees.
    if (!built || tr.reconfigured || built.hidden !== hidden || built.lines !== doc.lines) {
      rebuilds.whole++;
      return remember(buildDecorations(state), state);
    }
    const spans = [];
    let set = value;
    let definitions = false;
    if (tr.docChanged) {
      set = set.map(tr.changes);
      tr.changes.iterChangedRanges(function (fromA, toA, fromB, toB) {
        spans.push([fromB, toB]);
        const was = wholeBlocks(tr.startState.doc, built.tree, fromA, toA);
        if (holdsDefinition(built.tree, was[0], was[1])) definitions = true;
      });
    }
    if (tree !== built.tree) {
      const differ = blocksDiffer(built.tree, tree, doc.length - tr.startState.doc.length);
      if (differ && differ.now) spans.push(differ.now);
      if (differ && differ.old) {
        if (holdsDefinition(built.tree, differ.old[0], differ.old[1])) definitions = true;
        spans.push([tr.changes.mapPos(differ.old[0], -1), tr.changes.mapPos(differ.old[1], 1)]);
      }
    }
    built.ranges.forEach(function (r) {
      spans.push([tr.changes.mapPos(r.from, -1), tr.changes.mapPos(r.to, 1)]);
    });
    activeRanges(state).forEach(function (r) {
      spans.push([r.from, r.to]);
    });
    // Whole lines and whole blocks, in order, the ones that meet made one.
    const regions = [];
    spans
      .map(function (s) {
        return wholeBlocks(doc, tree, s[0], s[1]);
      })
      .sort(function (p, q) {
        return p[0] - q[0];
      })
      .forEach(function (s) {
        const last = regions[regions.length - 1];
        if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]);
        else regions.push([s[0], s[1]]);
      });
    let size = 0;
    regions.forEach(function (r) {
      size += r[1] - r[0];
      if (!definitions && holdsDefinition(tree, r[0], r[1])) definitions = tr.docChanged || tree !== built.tree;
    });
    if (definitions || size > doc.length / 2) {
      rebuilds.whole++;
      return remember(buildDecorations(state), state);
    }
    rebuilds.part++;
    // The definitions are the ones the tree before had: nothing that holds
    // one changed.
    if (tree !== built.tree && definitionsByTree.has(built.tree) && !definitionsByTree.has(tree)) {
      definitionsByTree.set(tree, definitionsByTree.get(built.tree));
    }
    regions.forEach(function (r) {
      set = set.update({
        filterFrom: r[0],
        filterTo: r[1],
        // By where it starts: a decoration is its block's, and a block's
        // decorations start on the block's lines. Not by where it ends: the
        // marker of an item whose text starts on the next line takes the
        // line break too, and ends where the next region begins.
        filter: function (from) {
          return from < r[0] || from > r[1];
        },
        add: buildDecorations(state, { from: r[0], to: r[1] }),
        sort: true,
      });
    });
    return remember(set, state);
  }

  // The first place two sets of decorations part, for the tests: what the
  // rebuild of a few blocks leaves has to be what a rebuild of the whole
  // document gives.
  function decorationsDiffer(one, other) {
    const list = function (set) {
      const out = [];
      for (let c = set.iter(); c.value; c.next()) out.push({ from: c.from, to: c.to, value: c.value });
      return out;
    };
    const a = list(one);
    const b = list(other);
    const describe = function (r) {
      const spec = r.value.spec || {};
      const widget = spec.widget ? spec.widget.constructor.name : "";
      return r.from + "-" + r.to + " " + (spec.class || widget || (spec.attributes ? JSON.stringify(spec.attributes) : "replace"));
    };
    // The neighbours of a range in its list, so that a report says where.
    const around = function (list, at) {
      return " [" + list.slice(Math.max(0, at - 3), at + 4).map(describe).join(", ") + "]";
    };
    const used = new Set();
    for (let i = 0; i < a.length; i++) {
      let match = -1;
      for (let j = Math.max(0, i - 40); j < Math.min(b.length, i + 40); j++) {
        if (used.has(j) || b[j].from !== a[i].from || b[j].to !== a[i].to) continue;
        if (b[j].value === a[i].value || b[j].value.eq(a[i].value)) {
          match = j;
          break;
        }
      }
      if (match < 0) return "only in the first: " + describe(a[i]) + around(a, i) + " against" + around(b, i);
      used.add(match);
    }
    for (let j = 0; j < b.length; j++) {
      if (!used.has(j)) return "only in the second: " + describe(b[j]) + around(b, j) + " against" + around(a, j);
    }
    return null;
  }

  // The tree is built in the background for a long document; when a later
  // piece of it lands, the language plugin dispatches a transaction, and the
  // field sees a different tree and rebuilds what that piece holds.
  const renderField = StateField.define({
    create: function (state) {
      return remember(buildDecorations(state), state);
    },
    update: function (value, tr) {
      const released = tr.effects.some(function (e) {
        return e.is(pointerReleased);
      });
      // A caret or the focus moving under a held button: the rebuild waits
      // for the release (pointerHeld). The text changing, or the tree, or
      // the count the host keeps back, is drawn at once whatever the button.
      const byGesture =
        tr.selection || tr.state.field(focusField) !== tr.startState.field(focusField);
      const byContent =
        tr.docChanged ||
        tr.state.field(hiddenLinesField) !== tr.startState.field(hiddenLinesField) ||
        CM.syntaxTree(tr.state) !== CM.syntaxTree(tr.startState);
      if (byContent || released || (byGesture && !pointerHeld)) {
        heldRebuild = false;
        return rebuilt(value, tr);
      }
      if (byGesture) heldRebuild = true;
      return value;
    },
    provide: function (f) {
      return EditorView.decorations.from(f);
    },
  });

  // Hyphen opportunities belong to prose alone and survive a caret arriving:
  // revealing a Markdown mark must not move a whole word to the next row.
  // A mark on the preceding letter generates a soft hyphen through CSS. No
  // widget buffer, document character or atomic range intervenes, so normal
  // Backspace, Delete, selection, copy and undo all retain their text offsets.
  const refreshHyphenation = CM.StateEffect.define();
  // Raw TeX, an attribute, a citation and a footnote's label are not words
  // of the page either: it drops the first two and prints the others as
  // something else.
  const HYPHEN_SKIP = /^(?:InlineCode|InlineMath|InlineBlockMath|Image|Autolink|URL|LinkTitle|LinkLabel|HTMLTag|Comment|ProcessingInstruction|Escape|Entity|RawTeX|Attribute|Citation|FootnoteRef)$/;
  const HYPHEN_BLOCK_SKIP = new RegExp("^(?:FrontMatter|FencedCode|CodeBlock|BlockMath|Table|" + RAW_HTML + ")$");

  function buildHyphens(state) {
    if (hyphenation !== "auto") return Decoration.none;
    const tree = CM.syntaxTree(state), doc = state.doc, decos = [];
    const lang = documentLanguage(state);
    function prose(from, to) {
      // The page prints `--` and `---` as dashes (G015), which part the words
      // beside them; as hyphens they joined the two into one the segmenter
      // leaves whole, so `word---word` was divided on the page alone. Blanked
      // at the same length, so the positions stand.
      const text = doc.sliceString(from, to).replace(/-{2,3}/g, function (run) {
        return " ".repeat(run.length);
      });
      window.MDM_HYPHENATION.segments(text, lang).forEach(function (span) {
        const at = from + span.to;
        decos.push(Decoration.mark({ class: "mdm-hyphen" }).range(at - 1, at));
      });
    }
    function inline(node) {
      if (HYPHEN_SKIP.test(node.name)) return;
      let from = node.from;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        prose(from, child.from);
        inline(child);
        from = child.to;
      }
      prose(from, node.to);
    }
    tree.iterate({ enter: function (node) {
      if (HYPHEN_BLOCK_SKIP.test(node.name)) return false;
      if (node.name === "Paragraph") {
        inline(node.node);
        return false;
      }
    } });
    return Decoration.set(decos, true);
  }

  const hyphenationField = StateField.define({
    create: buildHyphens,
    update: function (value, tr) {
      return tr.docChanged || CM.syntaxTree(tr.state) !== CM.syntaxTree(tr.startState) ||
        tr.effects.some(function (effect) { return effect.is(refreshHyphenation); })
        ? buildHyphens(tr.state) : value;
    },
    provide: function (field) { return EditorView.decorations.from(field); },
  });

  // ---------- Syntax colours in the editor ----------

  // Code inside fences and the YAML header are painted from the ten slots of
  // the palette (--mdm-syn-*, set on #app by applyPalette); the inline marks
  // of Markdown, bold and the rest, take the styles Typora gives them. The
  // heading sizes and the block grounds are line classes in style.css.
  const tags = CM.tags;
  const mdmHighlight = CM.HighlightStyle.define([
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.monospace, fontFamily: "var(--vscode-editor-font-family, monospace)" },
    { tag: tags.processingInstruction, class: "mdm-mark" },
    { tag: tags.escape, class: "mdm-mark" },
    { tag: tags.comment, color: "var(--mdm-syn-comment)" },
    { tag: tags.lineComment, color: "var(--mdm-syn-comment)" },
    { tag: tags.blockComment, color: "var(--mdm-syn-comment)" },
    { tag: tags.docComment, color: "var(--mdm-syn-comment)" },
    { tag: tags.meta, color: "var(--mdm-syn-comment)" },
    { tag: tags.string, color: "var(--mdm-syn-string)" },
    { tag: tags.special(tags.string), color: "var(--mdm-syn-string)" },
    { tag: tags.regexp, color: "var(--mdm-syn-string)" },
    { tag: tags.character, color: "var(--mdm-syn-string)" },
    { tag: tags.number, color: "var(--mdm-syn-number)" },
    { tag: tags.integer, color: "var(--mdm-syn-number)" },
    { tag: tags.float, color: "var(--mdm-syn-number)" },
    { tag: tags.bool, color: "var(--mdm-syn-number)" },
    { tag: tags.null, color: "var(--mdm-syn-number)" },
    { tag: tags.atom, color: "var(--mdm-syn-number)" },
    { tag: tags.literal, color: "var(--mdm-syn-number)" },
    { tag: tags.keyword, color: "var(--mdm-syn-keyword)" },
    { tag: tags.controlKeyword, color: "var(--mdm-syn-keyword)" },
    { tag: tags.operatorKeyword, color: "var(--mdm-syn-keyword)" },
    { tag: tags.definitionKeyword, color: "var(--mdm-syn-keyword)" },
    { tag: tags.moduleKeyword, color: "var(--mdm-syn-keyword)" },
    { tag: tags.modifier, color: "var(--mdm-syn-keyword)" },
    { tag: tags.self, color: "var(--mdm-syn-keyword)" },
    { tag: tags.tagName, color: "var(--mdm-syn-keyword)" },
    { tag: tags.attributeName, color: "var(--mdm-syn-attr)" },
    { tag: tags.propertyName, color: "var(--mdm-syn-attr)" },
    { tag: tags.attributeValue, color: "var(--mdm-syn-string)" },
    { tag: tags.function(tags.variableName), color: "var(--mdm-syn-name)" },
    { tag: tags.function(tags.propertyName), color: "var(--mdm-syn-name)" },
    { tag: tags.definition(tags.variableName), color: "var(--mdm-syn-name)" },
    { tag: tags.macroName, color: "var(--mdm-syn-name)" },
    { tag: tags.labelName, color: "var(--mdm-syn-name)" },
    { tag: tags.namespace, color: "var(--mdm-syn-name)" },
    { tag: tags.className, color: "var(--mdm-syn-type)" },
    { tag: tags.typeName, color: "var(--mdm-syn-type)" },
    { tag: tags.standard(tags.variableName), color: "var(--mdm-syn-type)" },
    { tag: tags.variableName, color: "var(--mdm-syn-variable)" },
    { tag: tags.special(tags.variableName), color: "var(--mdm-syn-variable)" },
    { tag: tags.operator, color: "var(--mdm-syn-base)" },
    { tag: tags.punctuation, color: "var(--mdm-syn-base)" },
    { tag: tags.bracket, color: "var(--mdm-syn-base)" },
    // The score source (```abc) is painted apart: its tags are the
    // extension's own (see abc.js in the bundle) and answer to none of the
    // slots above, so a score keeps the extension's own brass whatever
    // palette the VS Code theme hands the rest of the code. Classes and not
    // colours: the two palettes live in style.css, which is also where the
    // twelve buckets below are spent on their seven roles.
    { tag: CM.abcTags.field, class: "mdm-abc-field" },
    { tag: CM.abcTags.fieldText, class: "mdm-abc-fieldtext" },
    { tag: CM.abcTags.fieldValue, class: "mdm-abc-fieldval" },
    { tag: CM.abcTags.note, class: "mdm-abc-note" },
    { tag: CM.abcTags.accidental, class: "mdm-abc-accidental" },
    { tag: CM.abcTags.duration, class: "mdm-abc-duration" },
    { tag: CM.abcTags.rest, class: "mdm-abc-rest" },
    { tag: CM.abcTags.bar, class: "mdm-abc-bar" },
    { tag: CM.abcTags.decoration, class: "mdm-abc-deco" },
    { tag: CM.abcTags.chord, class: "mdm-abc-chord" },
    { tag: CM.abcTags.lyric, class: "mdm-abc-lyric" },
    { tag: CM.abcTags.comment, class: "mdm-abc-comment" },
  ]);

  // ---------- Commands ----------

  // Every command maps over all the selection ranges, so with several carets
  // it does its thing at each of them.

  // ---- Inline marks ----

  // The node each mark makes. Superscript and subscript are Pandoc's `x^2^`
  // and `H~2~O`, which the editor's parser reads too (the Superscript and
  // Subscript nodes it draws raised and lowered), and `$` is the inline
  // equation: a pair of marks like the rest, so the Equation row of the
  // Insert menu writes one and takes it off again.
  const INLINE_KIND = {
    "**": "StrongEmphasis",
    "*": "Emphasis",
    "`": "InlineCode",
    "~~": "Strikethrough",
    "^": "Superscript",
    "~": "Subscript",
    "$": "InlineMath",
  };

  // The marks whose content cannot go in as it stands. Pandoc's superscript
  // and subscript break on a bare space (measured on the pandoc 3.8.3 the
  // Quarto here ships: `x^a b^` prints the carets, and the editor's own
  // parser breaks in the same place), so a space inside them is written as
  // Pandoc's escaped space, `x^a\ b^`, which both surfaces set as a no-break
  // space. A content that opens with a bracket is escaped as well: `x^[b]^`
  // is an inline footnote to Pandoc and `x^\[b]^` the superscript that was
  // asked for (measured the same day). The escapes come off with the marks.
  // A tab inside the content is left as it is, and breaks the mark on both
  // surfaces as a bare space would: Pandoc's escape is for the space, and a
  // tab inside a word is not a line anybody has written.
  const ESCAPED_CONTENT = { "^": true, "~": true };

  // The escapes such a content needs, written into `out` in order: a
  // backslash before every bare space in [from, to], and before a bracket at
  // its head.
  function escapeContent(state, from, to, out) {
    const text = state.sliceDoc(from, to);
    if (text.charAt(0) === "[") out.push({ from: from, insert: "\\" });
    for (let i = 0; i < text.length; i++) {
      if (text.charAt(i) === " " && text.charAt(i - 1) !== "\\") out.push({ from: from + i, insert: "\\" });
    }
  }

  // And the same escapes taken off, for a content that stops being one.
  function unescapeContent(state, from, to, out) {
    const text = state.sliceDoc(from, to);
    for (let i = 0; i + 1 < text.length; i++) {
      if (text.charAt(i) !== "\\") continue;
      const next = text.charAt(i + 1);
      if (next !== " " && !(i === 0 && next === "[")) continue;
      out.push({ from: from + i, to: from + i + 1 });
      i++;
    }
  }

  // The span of `kind` around a position, or null; both sides are asked,
  // since a caret at the edge of the span's text is inside the span.
  function spanAround(tree, pos, kind) {
    const sides = [-1, 1];
    for (let i = 0; i < sides.length; i++) {
      for (let n = tree.resolveInner(pos, sides[i]); n; n = n.parent) {
        if (n.name === kind) return n;
      }
    }
    return null;
  }

  // The opening and closing marks of a span, or null when it has not both.
  function spanMarks(span) {
    const own =
      {
        InlineCode: "CodeMark",
        Strikethrough: "StrikethroughMark",
        Superscript: "SuperscriptMark",
        Subscript: "SubscriptMark",
        InlineMath: "InlineMathMark",
      }[span.name] || "EmphasisMark";
    const marks = span.getChildren(own);
    return marks.length >= 2 ? { open: marks[0], close: marks[marks.length - 1] } : null;
  }

  // The head of a line's own text: past the marks of the quotes, the list
  // marker and its task box, and the hashes of a heading.
  const LINE_PREFIX = /^(?:[ \t]*>)*[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?(?:#{1,6}[ \t]+)?/;

  // Whether a line is one no mark belongs on: code, an equation, raw HTML,
  // the header, the delimiter row of a table (one TableDelimiter node over
  // the line, where a pipe of a row is a TableDelimiter of one character).
  const UNMARKABLE = new RegExp("^(?:FencedCode|CodeBlock|BlockMath|FrontMatter|" + RAW_HTML + ")$");
  function unmarkableLine(tree, line) {
    for (let n = tree.resolveInner(line.from, 1); n; n = n.parent) {
      if (UNMARKABLE.test(n.name)) return true;
      if (n.name === "TableDelimiter" && n.to - n.from > 1) return true;
    }
    return false;
  }

  // The part of [from, to] on one line that a mark can wrap: the line's own
  // text, with the spaces at either end left outside the marks (a `**`
  // after a space cannot close, CommonMark 6.2), or null.
  function wrappablePart(state, tree, line, from, to) {
    if (unmarkableLine(tree, line)) return null;
    let a = Math.max(from, line.from + LINE_PREFIX.exec(line.text)[0].length);
    let b = Math.min(to, line.to);
    while (a < b && /[ \t]/.test(state.sliceDoc(a, a + 1))) a++;
    while (b > a && /[ \t]/.test(state.sliceDoc(b - 1, b))) b--;
    return a < b ? { from: a, to: b } : null;
  }

  // Wraps [from, to] in `mark` as one run: a run of the same kind the part
  // starts or ends inside is extended over it (its mark inside the part
  // goes, the one outside serves), and the runs inside the part lose their
  // marks. A code span holding backticks gets a longer fence, and a space
  // inside it when its text starts or ends with a backtick (CommonMark 6.1);
  // a superscript or a subscript gets the escapes its content needs
  // (ESCAPED_CONTENT).
  //
  // The changes are pushed in order, the ones inside the part between the
  // two marks: a ChangeSet handed a change that starts before the one
  // before it composes the two and reads the later one's positions in the
  // document the earlier one has already changed (ChangeSet.of), which for
  // an escape written beside an inserted mark is a character out of place.
  function wrapPart(state, tree, mark, from, to, out) {
    const kind = INLINE_KIND[mark];
    let open = mark;
    let close = mark;
    // A tilde against the part would join the mark it writes into the `~~`
    // of a strikethrough, which is another reading altogether: measured on
    // pandoc 3.8.3, `~~~x~~~` is a subscript and the strikeout is gone. The
    // part is left as it stands, and the button does nothing.
    if (mark === "~" && (state.sliceDoc(Math.max(0, from - 1), from) === "~" || state.sliceDoc(to, Math.min(state.doc.length, to + 1)) === "~")) {
      return;
    }
    if (mark === "`") {
      const text = state.sliceDoc(from, to);
      const runs = text.match(/`+/g);
      let longest = 0;
      if (runs) runs.forEach(function (r) { longest = Math.max(longest, r.length); });
      open = close = "`".repeat(longest + 1);
      if (text.startsWith("`") || text.endsWith("`")) {
        open += " ";
        close = " " + close;
      }
    }
    let skipOpen = false;
    let skipClose = false;
    const inner = [];
    tree.iterate({
      from: from,
      to: to,
      enter: function (n) {
        if (n.name !== kind) return;
        const marks = spanMarks(n.node);
        if (!marks) return false;
        if (marks.open.to <= from && to <= marks.close.from) {
          // Inside one run of the kind already: nothing to add.
          skipOpen = skipClose = true;
          return false;
        }
        if (marks.open.from >= from) inner.push({ from: marks.open.from, to: marks.open.to });
        else skipOpen = true;
        if (marks.close.to <= to) inner.push({ from: marks.close.from, to: marks.close.to });
        else skipClose = true;
        return false;
      },
    });
    if (ESCAPED_CONTENT[mark]) escapeContent(state, from, to, inner);
    inner.sort(function (a, b) {
      return a.from - b.from;
    });
    if (!skipOpen) out.push({ from: from, insert: open });
    inner.forEach(function (change) {
      out.push(change);
    });
    if (!skipClose) out.push({ from: to, insert: close });
  }

  // Ctrl+B, Ctrl+I, Ctrl+E and their buttons, the strikethrough button with
  // `~~` (Pandoc's strikeout, `<del>` on the page, 3.8.3), the superscript
  // and subscript buttons with `^` and `~`, and the Equation row of the
  // Insert menu with `$`: the marks on or off each
  // range, read off the tree (G063, G075: the raw characters either side of
  // the range were all that was looked at, so a caret inside bold wrote a
  // new pair into it, Ctrl+I on bold took one star off each side, and a
  // selection was wrapped whole across paragraphs, spaces and all). A caret
  // inside a run of the kind takes the run's marks off, and at the end of
  // the run's text steps out past its closing mark, so bold typed after
  // Ctrl+B is closed by a second Ctrl+B with no empty pair left; a caret in
  // the middle of a word wraps the word, and anywhere else writes an empty
  // pair to type into, which the same key takes off again. A selection of
  // the whole of a run's text takes the marks off, one inside the run is
  // taken out of it (the run closed before it and opened again after it),
  // and any other is wrapped line by line, each line's own text, merged
  // with the runs it touches.
  function toggleInline(mark) {
    return function (v) {
      const state = v.state;
      const tree = CM.syntaxTree(state);
      const kind = INLINE_KIND[mark];
      const len = mark.length;
      v.dispatch(
        state.changeByRange(function (range) {
          const from = range.from;
          const to = range.to;
          const span = spanAround(tree, from, kind);
          const marks = span && spanMarks(span);
          if (marks && from >= marks.open.to && to <= marks.close.from) {
            if (range.empty && from === marks.close.from && from > marks.open.to) {
              return { range: CM.EditorSelection.cursor(marks.close.to) };
            }
            const out = [];
            if (range.empty || (from === marks.open.to && to === marks.close.from)) {
              out.push({ from: marks.open.from, to: marks.open.to });
              if (ESCAPED_CONTENT[mark]) unescapeContent(state, marks.open.to, marks.close.from, out);
              out.push({ from: marks.close.from, to: marks.close.to });
            } else {
              // Out of the run: the spaces beside the selection stay outside
              // the marks, and a side with nothing left loses its mark.
              let a = from;
              let b = to;
              while (a > marks.open.to && /[ \t]/.test(state.sliceDoc(a - 1, a))) a--;
              while (b < marks.close.from && /[ \t]/.test(state.sliceDoc(b, b + 1))) b++;
              // An escaped space comes out with its backslash, which would
              // otherwise be left against the mark written in its place and
              // escape it (`x^a\^ b^`).
              if (ESCAPED_CONTENT[mark] && a > marks.open.to && state.sliceDoc(a - 1, a) === "\\" && state.sliceDoc(a, a + 1) === " ") a--;
              if (a === marks.open.to) out.push({ from: marks.open.from, to: marks.open.to });
              else out.push({ from: a, insert: mark });
              if (ESCAPED_CONTENT[mark]) unescapeContent(state, a, b, out);
              if (b === marks.close.from) out.push({ from: marks.close.from, to: marks.close.to });
              else out.push({ from: b, insert: mark });
            }
            const set = state.changes(out);
            return { changes: set, range: range.map(set) };
          }
          // A bare pair around the range, an empty one typed and left: off
          // again. Not the inner stars of a strong run whose text is the
          // range, which are the run's own (Ctrl+I on bold makes it bold
          // italic), and not the inner tildes of a strikethrough: one off
          // each side would make the strikeout a subscript, and wrapPart
          // leaves such a run alone for the reason named there.
          const before = state.sliceDoc(Math.max(0, from - len), from);
          const after = state.sliceDoc(to, Math.min(state.doc.length, to + len));
          const outer = mark === "*" ? "StrongEmphasis" : mark === "~" ? "Strikethrough" : null;
          const host = outer ? spanAround(tree, from, outer) : null;
          const hostMarks = host && spanMarks(host);
          const theirs = !!hostMarks && hostMarks.open.to === from && hostMarks.close.from === to;
          if (before === mark && after === mark && !theirs) {
            return {
              changes: [
                { from: from - len, to: from },
                { from: to, to: to + len },
              ],
              range: CM.EditorSelection.range(from - len, to - len),
            };
          }
          if (range.empty) {
            const line = state.doc.lineAt(from);
            const col = from - line.from;
            const word = /[\p{L}\p{N}]/u;
            if (col > 0 && col < line.length && word.test(line.text[col - 1]) && word.test(line.text[col])) {
              let a = col;
              let b = col;
              while (a > 0 && word.test(line.text[a - 1])) a--;
              while (b < line.length && word.test(line.text[b])) b++;
              const out = [];
              wrapPart(state, tree, mark, line.from + a, line.from + b, out);
              const set = state.changes(out);
              return { changes: set, range: range.map(set) };
            }
            return {
              changes: [
                { from: from, insert: mark },
                { from: to, insert: mark },
              ],
              range: CM.EditorSelection.range(from + len, to + len),
            };
          }
          const out = [];
          const last = state.doc.lineAt(to).number;
          for (let n = state.doc.lineAt(from).number; n <= last; n++) {
            const part = wrappablePart(state, tree, state.doc.line(n), from, to);
            if (part) wrapPart(state, tree, mark, part.from, part.to, out);
          }
          const set = state.changes(out);
          return { changes: set, range: range.map(set) };
        })
      );
      return true;
    };
  }

  // ---- Links, images and the spans written like them ----
  //
  // What reads one of these; what writes a link or a picture is one gesture
  // for the two of them and stands with the Insert menu below (linkGesture).

  // The link or image around a position, or null.
  function linkAround(tree, pos) {
    const sides = [-1, 1];
    for (let i = 0; i < sides.length; i++) {
      for (let n = tree.resolveInner(pos, sides[i]); n; n = n.parent) {
        if (n.name === "Link" || n.name === "Image") return n;
      }
    }
    return null;
  }

  // The highlight button writes Pandoc's bracketed span, `[text]{.mark}`,
  // which the page writes as `<mark>` (measured on the Pandoc 3.8.3 Quarto
  // ships here). GitHub's `==text==` is not this and neither surface reads
  // it: Pandoc 3.8.3 prints the four equals signs. The class is an argument
  // because the shape is general: the underline button that was taken off
  // used it, and small caps would.
  // Not a pair of marks like bold and the rest, so the edit has a shape of
  // its own. Inside a span already, the class goes on or off that span's own
  // attribute, so the two buttons stack into `{.mark .underline}` instead of
  // nesting a span in a span, and the span itself comes off with the last of
  // its classes (`{.mark .underline}` is still read, and still written by
  // hand, though only one button writes one of them now). Anywhere else the
  // range is wrapped: the word at a bare
  // caret, as the marks do, each line's own text across a selection that
  // spans lines, and an empty span to type into where there is no word.
  function toggleSpan(className) {
    // The class with one space beside it: the space before it where there is
    // one, the space after it where the class is the first in the attribute,
    // so a span written `{.mark .underline}` by hand loses either class
    // cleanly and never keeps a space against the brace.
    const has = new RegExp("(\\s*)\\." + className + "(?![\\w-])(\\s*)");
    const bare = /^\{\s*\}$/;
    return function (v) {
      const state = v.state;
      const tree = CM.syntaxTree(state);
      const close = "]{." + className + "}";
      v.dispatch(
        state.changeByRange(function (range) {
          const from = range.from;
          const to = range.to;
          const span = spanAround(tree, from, "Span");
          const attr = span && span.getChild("Attribute");
          const marks = span ? span.getChildren("LinkMark") : [];
          if (attr && marks.length >= 2 && to <= span.to) {
            const src = state.sliceDoc(attr.from, attr.to);
            if (attributeClasses(src).indexOf(className) < 0) {
              const set = state.changes({
                from: attr.to - 1,
                insert: (bare.test(src) ? "." : " .") + className,
              });
              return { changes: set, range: range.map(set) };
            }
            const m = has.exec(src);
            const cut = m[1] ? m[0].length - m[2].length : m[0].length;
            const left = src.slice(0, m.index) + src.slice(m.index + cut);
            const set = state.changes(
              bare.test(left)
                ? [
                    { from: marks[0].from, to: marks[0].to },
                    { from: marks[1].from, to: attr.to },
                  ]
                : { from: attr.from + m.index, to: attr.from + m.index + cut }
            );
            return { changes: set, range: range.map(set) };
          }
          if (range.empty) {
            const line = state.doc.lineAt(from);
            const col = from - line.from;
            const word = /[\p{L}\p{N}]/u;
            if (col > 0 && col < line.length && word.test(line.text[col - 1]) && word.test(line.text[col])) {
              let a = col;
              let b = col;
              while (a > 0 && word.test(line.text[a - 1])) a--;
              while (b < line.length && word.test(line.text[b])) b++;
              const set = state.changes([
                { from: line.from + a, insert: "[" },
                { from: line.from + b, insert: close },
              ]);
              return { changes: set, range: range.map(set) };
            }
            const set = state.changes({ from: from, insert: "[" + close });
            return { changes: set, range: CM.EditorSelection.cursor(from + 1) };
          }
          const out = [];
          const last = state.doc.lineAt(to).number;
          for (let n = state.doc.lineAt(from).number; n <= last; n++) {
            const part = wrappablePart(state, tree, state.doc.line(n), from, to);
            if (!part) continue;
            out.push({ from: part.from, insert: "[" }, { from: part.to, insert: close });
          }
          const set = state.changes(out);
          return { changes: set, range: range.map(set) };
        })
      );
      return true;
    };
  }

  // ---- Headings and lists ----

  // The setext heading a line belongs to, or null.
  function setextAround(tree, line) {
    for (let n = tree.resolveInner(line.from, 1); n; n = n.parent) {
      if (/^SetextHeading[12]$/.test(n.name)) return n;
    }
    return null;
  }

  // The head of a line as the heading menu reads it: the quote marks, a
  // list marker with its task box, and a heading's hashes with the space.
  const HEADING_LINE = /^((?:[ \t]*>)*[ \t]*)((?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?((#{1,6})[ \t]+)?/;

  // The level of the heading a line is, 0 for a paragraph, or null for a
  // blank line or one no heading belongs on (code, an equation, the header).
  function headingLevel(tree, line) {
    if (/^[ \t>]*$/.test(line.text) || unmarkableLine(tree, line)) return null;
    const setext = setextAround(tree, line);
    if (setext) return setext.name === "SetextHeading1" ? 1 : 2;
    const m = HEADING_LINE.exec(line.text);
    return m[4] ? m[4].length : 0;
  }

  // The heading menu: every selected line made a heading of the level
  // picked, or a paragraph at 0. The hashes go after the mark of a quote and
  // in place of a list marker (G065: `# - Violin` made the marker heading
  // text), a setext heading becomes an ATX one with its underline gone (the
  // one form every level has), and blank lines and the lines no heading
  // belongs on are left alone. A paragraph asked of a list item keeps the
  // item: taking the marker is the list buttons' to do. On an empty line the
  // hashes are written for the caret to type after, as the list buttons
  // write their marker, and parted from a paragraph or an item above:
  // Pandoc 3.8.3 reads `Text.` over `## H` as `Text. ## H`, and an item's
  // text runs on into it the same way.
  function setHeading(level) {
    return function (v) {
      const state = v.state;
      const tree = CM.syntaxTree(state);
      const doc = state.doc;
      const hashes = level ? "#".repeat(level) + " " : "";
      const empty = emptyLineAtCaret(state, tree);
      if (empty) {
        if (hashes) startLine(v, tree, empty, hashes, false);
        return true;
      }
      const changes = [];
      const seen = new Set();
      state.selection.ranges.forEach(function (range) {
        const first = doc.lineAt(range.from).number;
        const last = doc.lineAt(range.to).number;
        for (let n = first; n <= last; n++) {
          if (seen.has(n)) continue;
          seen.add(n);
          const line = doc.line(n);
          if (/^[ \t>]*$/.test(line.text) || unmarkableLine(tree, line)) continue;
          const setext = setextAround(tree, line);
          if (setext) {
            const top = doc.lineAt(setext.from);
            const underline = doc.lineAt(setext.to);
            if (seen.has(top.number) && top.number !== n) continue;
            seen.add(top.number);
            seen.add(underline.number);
            const head = /^(?:[ \t]*>)*[ \t]*/.exec(top.text)[0].length;
            if (hashes) changes.push({ from: top.from + head, insert: hashes });
            changes.push({ from: doc.line(underline.number - 1).to, to: underline.to });
            continue;
          }
          const m = HEADING_LINE.exec(line.text);
          const at = line.from + m[1].length;
          if (m[4]) {
            const head = at + (m[2] || "").length;
            changes.push({ from: head, to: head + m[3].length, insert: hashes });
          } else if (hashes) {
            changes.push({ from: at, to: at + (m[2] || "").length, insert: hashes });
          }
        }
      });
      if (changes.length) v.dispatch({ changes: changes });
      return true;
    };
  }

  // The level of the line the caret is on: what the menu ticks and what a
  // key measures itself against. 0 is a paragraph, null a line no heading
  // belongs on (a blank one, a score, an equation).
  function headingAtCaret(state) {
    return state ? headingLevel(CM.syntaxTree(state), state.doc.lineAt(state.selection.main.head)) : null;
  }

  // What a heading row and its key both do, written once so the two cannot
  // drift: the level a line already has takes the heading off, as a list
  // button pressed a second time takes its list off, and every selected line
  // with it.
  function applyHeading(level) {
    return function (v) {
      setHeading(level === headingAtCaret(v.state) ? 0 : level)(v);
      return true;
    };
  }

  // The rows of the heading menu: Paragraph and the six levels, the one the
  // caret's line is on ticked, each naming its key. The Paragraph row was
  // taken off when the ticked level picked again started taking the heading
  // off, and it is back with the keys (2026-09-19): at the keyboard there is
  // no tick to read, so a hand that cannot see what level the line is needs
  // one key that says paragraph whatever it was.
  function headingMenuItems() {
    const current = headingAtCaret(view && view.state);
    return [0, 1, 2, 3, 4, 5, 6].map(function (level) {
      return {
        name: level ? "heading-" + level : "paragraph",
        label:
          (level ? "Heading " + level : "Paragraph") +
          (level === current ? '<span class="mdm-swatch__tick">✓</span>' : "") +
          '<span class="mdm-menu__key">' +
          shortcutLabel(String(level), BLOCK_MOD) +
          "</span>",
        click: function () {
          if (!view) return;
          applyHeading(level)(view);
          view.focus();
        },
      };
    });
  }

  // The head of a line as the list buttons read it: the quote marks, a list
  // marker or a heading's hashes, and a task box.
  const LIST_LINE = /^((?:[ \t]*>)*[ \t]*)(?:([-+*])[ \t]+|(\d+)[.)][ \t]+|(#{1,6})[ \t]+)?(\[[ xX]\][ \t]+)?/;

  // The lines the selection covers that a marker belongs on, once each and
  // read into their marks: not the blank ones, nor code, an equation or the
  // header.
  function markableLines(state, tree) {
    const doc = state.doc;
    const seen = new Set();
    const parsed = [];
    state.selection.ranges.forEach(function (range) {
      const first = doc.lineAt(range.from).number;
      const last = doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = doc.line(n);
        if (/^[ \t>]*$/.test(line.text) || unmarkableLine(tree, line)) continue;
        const m = LIST_LINE.exec(line.text);
        parsed.push({
          at: line.from + m[1].length,
          bullet: m[2],
          number: m[3],
          box: m[5] || "",
          markLen: m[0].length - m[1].length,
        });
      }
    });
    return parsed;
  }

  // A lone caret on a line with nothing of its own, where the line buttons
  // start a line of their kind to type into: the line, or null. Every line
  // button skips blank lines, so on an empty one they did nothing at all.
  function emptyLineAtCaret(state, tree) {
    const sel = state.selection;
    if (sel.ranges.length !== 1 || !sel.main.empty) return null;
    const line = state.doc.lineAt(sel.main.head);
    if (!/^[ \t>]*$/.test(line.text) || unmarkableLine(tree, line)) return null;
    return line;
  }

  // Writes a marker at the end of such a line, past a quote's `>` (with the
  // space a bare `>` lacks), and leaves the caret after it. Under a line of
  // a paragraph the line is kept blank and the marker goes on a new one
  // with the same quote marks: Pandoc lets neither a list nor a quote break
  // into a paragraph (3.8.3 reads `Text.` over `- a` as one paragraph,
  // `Text. - a`), where the editor's CommonMark would draw a list the page
  // does not have. An item under an item's paragraph is the next item of
  // that list and needs no blank line; a quote under one does.
  function startLine(v, tree, line, mark, item) {
    const doc = v.state.doc;
    let part = false;
    if (line.number > 1) {
      const prev = doc.line(line.number - 1);
      const block = /^[ \t>]*$/.test(prev.text) ? null : blockOfLine(tree, prev);
      if (block && block.name === "Paragraph") part = !(item && block.parent && block.parent.name === "ListItem");
    }
    const own = (/>$/.test(line.text) ? " " : "") + mark;
    const insert = part ? "\n" + line.text + own : own;
    v.dispatch({
      changes: { from: line.to, insert: insert },
      selection: CM.EditorSelection.cursor(line.to + insert.length),
    });
  }

  // The list buttons: a marker of the kind in front of each selected line's
  // own text, or off again when every line carries one already. A line with
  // the other kind of marker changes kind, a heading line's hashes make way
  // for the marker, a quote keeps its `>` in front, a task box stays, and
  // blank lines are left blank and not counted (G065: `1. - Violin`,
  // `4. > Cello` and a numbered blank line). The numbers run from one over
  // the lines taken. A caret on an empty line starts an item there.
  function toggleList(ordered) {
    return function (v) {
      const state = v.state;
      const tree = CM.syntaxTree(state);
      const empty = emptyLineAtCaret(state, tree);
      if (empty) {
        startLine(v, tree, empty, ordered ? "1. " : "- ", true);
        return true;
      }
      const parsed = markableLines(state, tree);
      const all =
        parsed.length > 0 &&
        parsed.every(function (p) {
          return ordered ? p.number : p.bullet;
        });
      const changes = [];
      let k = 0;
      parsed.forEach(function (p) {
        if (all) {
          changes.push({ from: p.at, to: p.at + p.markLen });
          return;
        }
        k++;
        if (ordered ? p.number : p.bullet) {
          if (ordered && p.number !== String(k)) changes.push({ from: p.at, to: p.at + p.number.length, insert: String(k) });
          return;
        }
        changes.push({ from: p.at, to: p.at + p.markLen - p.box.length, insert: ordered ? k + ". " : "- " });
      });
      if (changes.length) v.dispatch({ changes: changes });
      return true;
    };
  }

  // The task button: a box on each selected line, or off again when every
  // line has one. The box goes behind the marker an item has, bulleted or
  // numbered (Pandoc 3.8.3 ticks both), and a line with no marker, a
  // heading's hashes and all, becomes a bulleted task. Taken off, only the
  // box goes and the item stays an item, since the box is the one thing
  // this button adds to an item; the list buttons take the marker. A caret
  // on an empty line starts a task there.
  function toggleTask(v) {
    const state = v.state;
    const tree = CM.syntaxTree(state);
    const empty = emptyLineAtCaret(state, tree);
    if (empty) {
      startLine(v, tree, empty, "- [ ] ", true);
      return true;
    }
    const parsed = markableLines(state, tree);
    const boxed = function (p) {
      return !!p.box && !!(p.bullet || p.number);
    };
    const all = parsed.length > 0 && parsed.every(boxed);
    const changes = [];
    parsed.forEach(function (p) {
      const head = p.at + p.markLen - p.box.length;
      if (all) changes.push({ from: head, to: p.at + p.markLen });
      else if (boxed(p)) return;
      else if (p.bullet || p.number) changes.push({ from: head, insert: "[ ] " });
      else changes.push({ from: p.at, to: head, insert: "- [ ] " });
    });
    if (changes.length) v.dispatch({ changes: changes });
    return true;
  }

  // The block a line belongs to, below the containers that hold it (a
  // paragraph, a heading, a fence, a table), read at the head of the line's
  // own text so an item's marker does not answer for its paragraph; null on
  // a line that is only containers. Read from the root down, the first
  // node under the run of containers: walked up from the inside, the tree
  // of a language mounted in the block (the header's YAML) has holders'
  // names of its own and stopped the walk inside it.
  function blockOfLine(tree, line) {
    const head = Math.min(line.from + LINE_PREFIX.exec(line.text)[0].length, line.to);
    const chain = [];
    for (let n = tree.resolveInner(head, head < line.to ? 1 : -1); n; n = n.parent) chain.unshift(n);
    for (let i = 0; i < chain.length; i++) {
      if (!CODE_HOLDERS.test(chain[i].name)) return chain[i];
    }
    return null;
  }

  // The lines the quote button works on: those the selection touches, taken
  // out to the whole of every block they are part of, less the blank lines
  // at the edges. A paragraph is taken whole because a line left out of it
  // stays in the quote anyway, as lazy continuation (CommonMark 5.1), and a
  // fence or a table would be cut in two. A selection that ends at the head
  // of a line, as a triple click leaves it, does not take that line. The
  // header is never quoted.
  function quoteLines(state, tree) {
    const doc = state.doc;
    const lines = new Set();
    state.selection.ranges.forEach(function (range) {
      let first = doc.lineAt(range.from).number;
      let last = doc.lineAt(range.to).number;
      if (last > first && range.to === doc.line(last).from) last--;
      for (let n = first; n <= last; n++) {
        const block = blockOfLine(tree, doc.line(n));
        if (!block) continue;
        first = Math.min(first, doc.lineAt(block.from).number);
        last = Math.max(last, lastLineOf(doc, block).number);
      }
      const taken = [];
      for (let n = first; n <= last; n++) {
        const block = blockOfLine(tree, doc.line(n));
        if (!(block && block.name === "FrontMatter")) taken.push(n);
      }
      while (taken.length && isBlank(doc.line(taken[0]).text)) taken.shift();
      while (taken.length && isBlank(doc.line(taken[taken.length - 1]).text)) taken.pop();
      taken.forEach(function (n) {
        lines.add(n);
      });
    });
    return Array.from(lines).sort(function (a, b) {
      return a - b;
    });
  }

  // The first `>` of a line, behind an item's marker when the quote is in
  // a list, and the one space after it.
  const QUOTE_MARK = /^([ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)>[ \t]?/;

  // The quote button: each line of the blocks the selection touches one
  // quote deeper, blank lines between them included so the blocks stay one
  // quote, or one quote shallower when every line is in a quote already.
  // The `>` goes at the head of the line, so a list selected becomes a
  // list in a quote. A caret on an empty line starts a quote there.
  function toggleQuote(v) {
    const state = v.state;
    const tree = CM.syntaxTree(state);
    const empty = emptyLineAtCaret(state, tree);
    if (empty) {
      startLine(v, tree, empty, "> ", false);
      return true;
    }
    const doc = state.doc;
    const lines = quoteLines(state, tree).map(function (n) {
      return doc.line(n);
    });
    const quoted = function (line) {
      if (QUOTE_MARK.test(line.text)) return true;
      // A lazy line has no `>` of its own and is in the quote all the same.
      const head = Math.min(line.from + LINE_PREFIX.exec(line.text)[0].length, line.to);
      for (let n = tree.resolveInner(head, head < line.to ? 1 : -1); n; n = n.parent) {
        if (n.name === "Blockquote") return true;
      }
      return false;
    };
    const texts = lines.filter(function (line) {
      return !isBlank(line.text);
    });
    const all = texts.length > 0 && texts.every(quoted);
    const changes = [];
    lines.forEach(function (line) {
      if (!all) {
        changes.push({ from: line.from, insert: isBlank(line.text) ? ">" : "> " });
        return;
      }
      const m = QUOTE_MARK.exec(line.text);
      if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length });
    });
    if (changes.length) v.dispatch({ changes: changes });
    return true;
  }

  // ---- Code blocks ----

  // Blocks that are one piece: a selection that touches one takes the whole
  // of it into the new block, since the part left out would lose its fence,
  // its $$, its header row or its closing tag. A callout holds blocks and
  // is taken whole only when the selection reaches one of its ::: lines.
  const CODE_WHOLE = new RegExp("^(?:FencedCode|BlockMath|Table|FrontMatter|" + RAW_HTML + ")$");
  const CODE_HOLDERS = /^(?:Document|Blockquote|ListItem|BulletList|OrderedList|Callout)$/;

  // How far an item's content stands from where the item starts: its
  // marker and the spaces after it, and not a task box, which is content to
  // both readers. A fence set past the box is paragraph text to Pandoc,
  // where at the item's own column it is a block of the item (measured on
  // 3.8.3); Enter's continuation counts the box, for the text after it.
  function itemWidth(level) {
    const width = level.to - level.from;
    const box = /^( *)\[.\]$/.exec(level.type.slice(1));
    return box ? width - level.spaceAfter.length - box[0].length + box[1].length : width;
  }

  // Where a line's own text starts past the marks of the given container
  // levels (markupLevels): the > of a quote and the space after it, an
  // item's marker on the line the item opens, its indentation up to the
  // marker's width on the lines after.
  function prefixEnd(line, levels) {
    let pos = 0;
    levels.forEach(function (level) {
      if (!level.item) {
        const m = /^[ \t]*>[ \t]?/.exec(line.text.slice(pos));
        if (m) pos += m[0].length;
        return;
      }
      const width = itemWidth(level);
      if (level.item.from >= line.from && level.item.from <= line.to) {
        pos = Math.max(pos, level.from + width);
        return;
      }
      let take = 0;
      while (take < width && pos + take < line.length && /[ \t]/.test(line.text[pos + take])) take++;
      pos += take;
    });
    return Math.min(pos, line.length);
  }

  // A line with nothing of its own past the marks of its containers.
  function blankUnder(line, levels) {
    return isBlank(line.text.slice(prefixEnd(line, levels)));
  }

  // Whether an item of the levels opens on the line, which then carries
  // the item's marker where the other lines carry its indentation.
  function opensItem(line, levels) {
    return levels.some(function (level) {
      return level.item && level.item.from >= line.from && level.item.from <= line.to;
    });
  }

  // The marks the lines of a new block carry inside the given levels: what
  // Enter writes on a line that goes on inside them, with an item's
  // indentation taken to its content's column.
  function blockPrefix(levels, line) {
    const prefix = continuationPrefix(levels, line);
    const inner = levels[levels.length - 1];
    if (!inner || !inner.item) return prefix;
    const own = inner.blank(null);
    return (
      prefix.slice(0, prefix.length - own.length) +
      inner.spaceBefore +
      " ".repeat(Math.max(0, itemWidth(inner) - inner.spaceBefore.length))
    );
  }

  // The container levels a line stands in. A fence's lines are read from
  // the fence, since markupLevels stops at one: its lines are not Markdown.
  function lineLevels(tree, doc, line) {
    let node = tree.resolveInner(line.to, -1);
    for (let n = node; n; n = n.parent) {
      if (n.name === "FencedCode") {
        node = n.parent;
        break;
      }
    }
    return markupLevels(node, doc);
  }

  function sameLevel(a, b) {
    return (
      a.node.name === b.node.name &&
      a.node.from === b.node.from &&
      (a.item ? !!b.item && a.item.from === b.item.from : !b.item)
    );
  }

  // The fenced block a line is one of, its fence lines included, or null.
  function fenceOfLine(tree, line) {
    const probes = [
      [line.to, -1],
      [line.from, 1],
    ];
    for (let i = 0; i < probes.length; i++) {
      for (let n = tree.resolveInner(probes[i][0], probes[i][1]); n; n = n.parent) {
        if (n.name === "FencedCode") return n;
      }
    }
    return null;
  }

  // The nodes above a line, from both of its ends, each named once.
  function nodesAbove(tree, line) {
    const found = [];
    const probes = [
      [line.to, -1],
      [line.from, 1],
    ];
    probes.forEach(function (probe) {
      for (let n = tree.resolveInner(probe[0], probe[1]); n; n = n.parent) {
        const known = found.some(function (f) {
          return f.name === n.name && f.from === n.from && f.to === n.to;
        });
        if (!known) found.push(n);
      }
    });
    return found;
  }

  // The last line of a node, not the line after it when the node takes the
  // line break with it.
  function lastLineOf(doc, node) {
    const line = doc.lineAt(node.to);
    return node.to === line.from && node.to > node.from ? doc.line(line.number - 1) : line;
  }

  // The fences of a block taken off, its lines left as they stand. A block
  // with nothing in it goes whole and leaves one blank line, and never the
  // blank lines around it: which of those the button wrote cannot be read
  // off the text (a blank line under a paragraph and two blank lines under
  // it come out as the same block), and taking one it did not write glued
  // the next paragraph to the one above.
  function unfence(doc, fence) {
    const levels = markupLevels(fence.parent, doc);
    const open = doc.lineAt(fence.from);
    const marks = fence.getChildren("CodeMark");
    const last = marks[marks.length - 1];
    const close = marks.length > 1 && doc.lineAt(last.from).number > open.number ? doc.lineAt(last.from) : null;
    const end = close ? close.number - 1 : lastLineOf(doc, fence).number;
    if (end > open.number) {
      const next = doc.line(open.number + 1);
      const out = [{ from: open.from + prefixEnd(open, levels), to: next.from + prefixEnd(next, levels) }];
      if (close) out.push({ from: doc.line(end).to, to: close.to });
      return out;
    }
    // The marks of the line kept, an item's marker with its space and a
    // quote's > without it.
    let keep = prefixEnd(open, levels);
    if (!opensItem(open, levels)) {
      while (keep > 0 && /[ \t]/.test(open.text[keep - 1])) keep--;
    }
    return [{ from: open.from + keep, to: (close || open).to }];
  }

  // ---- Writing a block where a block belongs ----
  //
  // What the code block button does with a bare caret, for any block that
  // stands on lines of its own: the equation, the table and the rule of the
  // Insert menu are written the same way, since a rule put through a
  // paragraph would cut it in two.
  //
  // `lines` is the block as it is written and `caret` {line, col} where the
  // caret is left in it. The lines carry the marks of the containers around
  // them (blockPrefix), the first one an item's own marker where the block
  // takes over a line that opens an item, and a blank line parts the block
  // from the text beside it: the page leaves air around a block whatever
  // the source says, and the editor draws that air only from a blank line.
  // Not inside a list item, where the blank line would be all the block
  // added to the list besides itself.

  // Whether any level is a list item.
  function insideItem(levels) {
    return levels.some(function (level) {
      return !!level.item;
    });
  }

  // Whether line `n` of the document has text of its own inside `levels`.
  function textOnLine(doc, n, levels) {
    return n >= 1 && n <= doc.lines && !blankUnder(doc.line(n), levels);
  }

  // The lines behind their marks, and where the caret lands in the result.
  function blockBody(head, prefix, lines, caret, br) {
    let text = "";
    let at = 0;
    lines.forEach(function (own, i) {
      text += (i ? br + prefix : head) + own;
      if (i === caret.line) at = text.length - own.length + caret.col;
    });
    return { text: text, at: at };
  }

  // The block in place of a blank line.
  function blockOn(state, doc, line, levels, lines, caret) {
    const br = state.lineBreak;
    const prefix = blockPrefix(levels, line);
    const head = opensItem(line, levels) ? line.text.slice(0, prefixEnd(line, levels)) : prefix;
    const quiet = prefix.replace(/[ \t]+$/, "");
    const lone = insideItem(levels);
    const lead = !lone && textOnLine(doc, line.number - 1, levels) ? quiet + br : "";
    const tail = !lone && textOnLine(doc, line.number + 1, levels) ? br + quiet : "";
    const body = blockBody(head, prefix, lines, caret, br);
    return {
      changes: { from: line.from, to: line.to, insert: lead + body.text + tail },
      range: CM.EditorSelection.cursor(line.from + lead.length + body.at),
    };
  }

  // The block under the block a line of text stands in, `end` being that
  // block's last line and `line` the one whose containers it goes inside.
  function blockAfter(state, doc, end, line, levels, lines, caret) {
    const br = state.lineBreak;
    const prefix = blockPrefix(levels, line);
    const quiet = prefix.replace(/[ \t]+$/, "");
    const lone = insideItem(levels);
    const lead = br + (lone ? "" : quiet + br);
    const tail = !lone && textOnLine(doc, end.number + 1, levels) ? br + quiet : "";
    const body = blockBody(prefix, prefix, lines, caret, br);
    return {
      changes: { from: end.to, insert: lead + body.text + tail },
      range: CM.EditorSelection.cursor(end.to + lead.length + body.at),
    };
  }

  // The one-piece block around a line, or null.
  function wholeAround(tree, line) {
    const nodes = nodesAbove(tree, line);
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (CODE_WHOLE.test(nodes[i].name)) return nodes[i];
    }
    return null;
  }

  // The last line of the block a line of text stands in: the whole of a
  // one-piece block, or of the paragraph, heading or other block it is part
  // of, so nothing is written through one.
  function blockEnd(tree, doc, line, levels) {
    const whole = wholeAround(tree, line);
    let end = line;
    if (whole) {
      end = lastLineOf(doc, whole);
    } else {
      let node = tree.resolveInner(line.from + prefixEnd(line, levels), 1);
      while (node.parent && !CODE_HOLDERS.test(node.parent.name)) node = node.parent;
      if (!CODE_HOLDERS.test(node.name)) end = lastLineOf(doc, node);
    }
    return end.number < line.number ? line : end;
  }

  // The code block button and Ctrl+Shift+C, the block twin of inline code
  // with its rules a level up. Inside a fenced block the fences come off
  // and the lines between them stay (a block with nothing in it leaves a
  // blank line). A selection goes into a new block: the lines it touches
  // less the blank ones at its edges, the whole of any fence, equation,
  // table or header it touches, and a fence one backtick longer than the
  // longest among its lines. A bare caret opens an empty block to type
  // into: on its line when the line is blank, and under the paragraph,
  // heading or other block it stands in otherwise, never through it. Either
  // way the caret is left right after the opening backticks, where the
  // language is written (`abc` for a score, `python`), and Enter from there
  // goes on into the block. The new lines carry the > of the quotes and the
  // indentation of the items around them, and a blank line parts the block
  // from text beside it: the page leaves air around a block whatever the
  // source says, and the editor draws that air only from a blank line. Not
  // inside a list item, where the blank line would be all the block added
  // to the list besides itself.
  function toggleCodeBlock(v) {
    const state = v.state;
    const tree = CM.syntaxTree(state);
    const doc = state.doc;
    const br = state.lineBreak;
    const FENCE = "```";
    const seen = new Set();
    // The caret is left right after the opening backticks, where the
    // language is written, which is line 0 of the two the block is.
    const FENCE_LINES = [FENCE, FENCE];
    const FENCE_CARET = { line: 0, col: FENCE.length };
    // An empty block in place of a blank line.
    const emptyOn = function (line, levels, range) {
      if (seen.has("on" + line.number)) return { range: range };
      seen.add("on" + line.number);
      return blockOn(state, doc, line, levels, FENCE_LINES, FENCE_CARET);
    };
    // An empty block under the block a line of text stands in.
    const emptyAfter = function (line, levels, range) {
      const end = blockEnd(tree, doc, line, levels);
      if (seen.has("after" + end.number)) return { range: range };
      seen.add("after" + end.number);
      return blockAfter(state, doc, end, line, levels, FENCE_LINES, FENCE_CARET);
    };
    const spec = state.changeByRange(function (range) {
      const top = doc.lineAt(range.from);
      let bottom = doc.lineAt(range.to);
      if (!range.empty && range.to === bottom.from && bottom.number > top.number) bottom = doc.line(bottom.number - 1);
      const fence = fenceOfLine(tree, top);
      const other = fence && fenceOfLine(tree, bottom);
      if (fence && other && other.from === fence.from) {
        if (seen.has("off" + fence.from)) return { range: range };
        seen.add("off" + fence.from);
        const set = state.changes(unfence(doc, fence));
        return { changes: set, range: range.map(set) };
      }
      if (range.empty) {
        const levels = lineLevels(tree, doc, top);
        if (blankUnder(top, levels) && !wholeAround(tree, top)) return emptyOn(top, levels, range);
        return emptyAfter(top, levels, range);
      }
      let first = top.number;
      let last = bottom.number;
      for (let grew = true; grew; ) {
        grew = false;
        [first, last].forEach(function (n) {
          nodesAbove(tree, doc.line(n)).forEach(function (node) {
            const from = doc.lineAt(node.from).number;
            const to = lastLineOf(doc, node).number;
            const cut = CODE_WHOLE.test(node.name) || (node.name === "Callout" && (from >= first || to <= last));
            if (!cut) return;
            if (from < first) {
              first = from;
              grew = true;
            }
            if (to > last) {
              last = to;
              grew = true;
            }
          });
        });
      }
      const blank = function (n) {
        const line = doc.line(n);
        return blankUnder(line, lineLevels(tree, doc, line));
      };
      while (first < last && blank(first)) first++;
      while (last > first && blank(last)) last--;
      const head = doc.line(first);
      if (first === last && blank(first)) return emptyOn(head, lineLevels(tree, doc, head), range);
      if (seen.has("wrap" + first)) return { range: range };
      seen.add("wrap" + first);
      const tail = doc.line(last);
      const upper = lineLevels(tree, doc, head);
      const lower = lineLevels(tree, doc, tail);
      const levels = [];
      for (let i = 0; i < upper.length && i < lower.length && sameLevel(upper[i], lower[i]); i++) levels.push(upper[i]);
      let longest = 2;
      for (let n = first; n <= last; n++) {
        const run = /^[ \t>]*(?:(?:[-+*]|\d+[.)])[ \t]+)?[ \t]*(`{3,})/.exec(doc.line(n).text);
        if (run) longest = Math.max(longest, run[1].length);
      }
      const fenceText = "`".repeat(longest + 1);
      const prefix = blockPrefix(levels, head);
      const quiet = prefix.replace(/[ \t]+$/, "");
      const lone = insideItem(levels);
      const at = head.from + prefixEnd(head, levels);
      const lead = !lone && textOnLine(doc, first - 1, levels) ? quiet + br : "";
      const out = [];
      if (lead && at > head.from) out.push({ from: head.from, insert: lead });
      out.push({ from: at, insert: (at === head.from ? lead : "") + fenceText + br + prefix });
      out.push({
        from: tail.to,
        insert: br + prefix + fenceText + (!lone && textOnLine(doc, last + 1, levels) ? br + quiet : ""),
      });
      return {
        changes: state.changes(out),
        range: CM.EditorSelection.cursor(at + lead.length + fenceText.length),
      };
    });
    v.dispatch(spec, { scrollIntoView: true });
    return true;
  }

  // ---- The Insert menu ----
  //
  // The annotations the bar has no button of its own for, behind one button
  // at the end of the block group (design-annotation-icons.html, the set the
  // owner picked): an equation inline or on lines of its own, a table, a
  // picture, a footnote and a rule. Every one of them writes standard
  // Pandoc, and the editor draws all six already; what was missing was the
  // gesture.

  // The three that stand on lines of their own go where the code block's
  // empty block goes (blockOn and blockAfter above): on the caret's line
  // when that line is blank, under the block the caret stands in otherwise,
  // and never through it.
  function insertBlock(lines, caret) {
    return function (v) {
      const state = v.state;
      const tree = CM.syntaxTree(state);
      const doc = state.doc;
      const seen = new Set();
      v.dispatch(
        state.changeByRange(function (range) {
          const line = doc.lineAt(range.from);
          const levels = lineLevels(tree, doc, line);
          if (blankUnder(line, levels) && !wholeAround(tree, line)) {
            if (seen.has("on" + line.number)) return { range: range };
            seen.add("on" + line.number);
            return blockOn(state, doc, line, levels, lines, caret);
          }
          const end = blockEnd(tree, doc, line, levels);
          if (seen.has("after" + end.number)) return { range: range };
          seen.add("after" + end.number);
          return blockAfter(state, doc, end, line, levels, lines, caret);
        }),
        { scrollIntoView: true }
      );
      return true;
    };
  }

  // The display equation, written as example.mdm writes one: the `$$` on
  // lines of their own with the maths between them, which is where the
  // caret is left.
  const EQUATION_BLOCK = ["$$", "", "$$"];
  const EQUATION_CARET = { line: 1, col: 0 };

  // A table of two columns and three rows, the shape of the row's own
  // glyph: the head, the row that carries the alignment, and two rows to
  // fill. The caret goes in the first cell of the head, which is the cell a
  // reader types first. Pandoc needs the delimiter row, and the editor
  // draws nothing without it.
  const TABLE_BLOCK = ["|  |  |", "| --- | --- |", "|  |  |", "|  |  |"];
  const TABLE_CARET = { line: 0, col: 2 };

  // The rule as `***`, and not `---`: text with `---` under it is a setext
  // heading to CommonMark and to Pandoc alike, so `***` is the one form
  // that may stand anywhere (the house rule, in CLAUDE.md).
  const RULE_BLOCK = ["***"];
  const RULE_CARET = { line: 0, col: 3 };

  // Ctrl+K and the link button, and the picture row of the menu, which is
  // the same gesture with a `!` in front (`bang`). Inside a link or an
  // image already, that one is edited and no new one nested in it (G074: of
  // two links one inside the other the inner one is the link, CommonMark
  // 6.3, so the outer one was lost): its address is selected, to be typed
  // over, or the caret goes between the parentheses of an empty one. An
  // address selected goes where the address goes, with the caret in the
  // label (ED29); for a picture a file name counts as an address too, since
  // that is what a picture's address usually is. Any other selection is the
  // label, with the caret where the address goes; the label of a picture is
  // what Quarto prints under the figure as its caption.
  const PICTURE_FILE = /\.(?:png|jpe?g|gif|svg|webp|pdf)$/i;
  function linkGesture(bang) {
    return function (v) {
      const state = v.state;
      const tree = CM.syntaxTree(state);
      v.dispatch(
        state.changeByRange(function (range) {
          const link = linkAround(tree, range.from);
          if (link && range.to <= link.to) {
            const marks = link.getChildren("LinkMark");
            let paren = null;
            for (let i = 0; i < marks.length && !paren; i++) {
              if (state.sliceDoc(marks[i].from, marks[i].to) === "(") paren = marks[i];
            }
            if (paren) {
              // The address after `](`, not an address the label may hold.
              const urls = link.getChildren("URL");
              for (let i = 0; i < urls.length; i++) {
                if (urls[i].from >= paren.to) return { range: CM.EditorSelection.range(urls[i].from, urls[i].to) };
              }
              return { range: CM.EditorSelection.cursor(paren.to) };
            }
            return { range: range };
          }
          const label = state.sliceDoc(range.from, range.to);
          if (/^(?:[a-z][a-z0-9+.-]*:|www\.)\S+$/i.test(label) || (bang && !/\s/.test(label) && PICTURE_FILE.test(label))) {
            const insert = bang + "[](" + label + ")";
            return {
              changes: { from: range.from, to: range.to, insert: insert },
              range: CM.EditorSelection.cursor(range.from + bang.length + 1),
            };
          }
          const insert = bang + "[" + label + "]()";
          return {
            changes: { from: range.from, to: range.to, insert: insert },
            range: CM.EditorSelection.cursor(range.from + insert.length - 1),
          };
        })
      );
      return true;
    };
  }
  const insertLink = linkGesture("");
  const insertPicture = linkGesture("!");

  // The labels already spoken for, references and definitions alike (the
  // definition's own `[^1]` is read by the same pattern).
  function footnoteLabels(doc) {
    const used = new Set();
    const ref = /\[\^([^\]\s]+)\]/g;
    const text = doc.toString();
    for (let m = ref.exec(text); m; m = ref.exec(text)) used.add(m[1]);
    return used;
  }

  // The footnote row: the reference after the words the caret is in, which
  // is where the glyph shows it, numbered with the lowest number the
  // document has not used, and the note itself at the end of the document
  // for the caret to type into. At the end because Pandoc reads a
  // definition at the top level alone (parseFootnoteDef, cx.depth 1), so
  // none may be written inside the quote or the list item the caret stands
  // in; under the last line that has text, or under the caret's own line
  // when that stands further down, parted by a blank line.
  function insertFootnote(v) {
    const state = v.state;
    const doc = state.doc;
    const br = state.lineBreak;
    const used = footnoteLabels(doc);
    const changes = [];
    const notes = [];
    let n = 1;
    let at = 0;
    for (let i = doc.lines; i >= 1; i--) {
      if (!isBlank(doc.line(i).text)) {
        at = doc.line(i).to;
        break;
      }
    }
    state.selection.ranges.forEach(function (range) {
      while (used.has(String(n))) n++;
      const label = String(n);
      used.add(label);
      changes.push({ from: range.to, insert: "[^" + label + "]" });
      notes.push("[^" + label + "]: ");
      at = Math.max(at, doc.lineAt(range.to).to);
    });
    changes.push({ from: at, insert: br + br + notes.join(br + br) });
    const set = state.changes(changes);
    v.dispatch({
      changes: set,
      // Past the whole of what was written at the end, which is the end of
      // the last note: what a reader types next is the note itself.
      selection: CM.EditorSelection.cursor(set.mapPos(at, 1)),
      scrollIntoView: true,
    });
    return true;
  }

  // Ctrl+Enter: out of the block the caret is in (a fence, an equation, a
  // list, a quote, a callout, a heading line), into a fresh paragraph below
  // it. Plain Enter inside a code block is a newline, as in any code editor:
  // the closing fence is a line of text the caret can walk past.
  // A paragraph among them: one written over two source lines was split at
  // the caret's line instead of left whole (G084).
  const LEAVABLE = new RegExp(
    "^(?:FencedCode|CodeBlock|BlockMath|Callout|Blockquote|BulletList|OrderedList|Table|ATXHeading[1-6]|SetextHeading[12]|FrontMatter|Paragraph|" +
      RAW_HTML +
      ")$"
  );
  function leaveBlock(v) {
    const state = v.state;
    const tree = CM.syntaxTree(state);
    const changes = [];
    const cursors = [];
    let offset = 0;
    state.selection.ranges.forEach(function (range) {
      let node = tree.resolveInner(range.head, -1);
      let block = null;
      while (node) {
        if (LEAVABLE.test(node.name)) block = node;
        node = node.parent;
      }
      const at = block ? state.doc.lineAt(block.to).to : state.doc.lineAt(range.head).to;
      const insert = "\n\n";
      changes.push({ from: at, insert: insert });
      cursors.push(at + insert.length + offset);
      offset += insert.length;
    });
    v.dispatch({
      changes: changes,
      selection: CM.EditorSelection.create(
        cursors.map(function (p) {
          return CM.EditorSelection.cursor(p);
        }),
        0
      ),
      scrollIntoView: true,
    });
    return true;
  }

  // A rendered block is out of the flow, so the arrow keys walk past it as
  // if it were not there; clicking is one way in, this is the other. Up or
  // Down onto a hidden block puts the caret inside it, which opens it: Down
  // into its first line, Up into its last. Only for a single collapsed caret:
  // with several, or a selection being extended, the editor's own motion is
  // what is wanted.
  function hiddenBlockAt(state, pos) {
    const field = state.field(renderField, false);
    if (!field) return null;
    let found = null;
    field.between(pos, pos, function (from, to, deco) {
      // Source taken out of the flow: a block replacement carrying nothing of
      // its own, or carrying the cover that says which line the block starts
      // at. A block replacement that draws something instead (the rule) is not
      // source behind a drawing, it is the drawing, and the arrow keys walk
      // past it as they always have.
      const hidden =
        deco.block &&
        deco.isReplace &&
        (!deco.widget || deco.widget instanceof BlockCoverWidget);
      if (hidden && from <= pos && pos <= to) found = { from: from, to: to };
    });
    return found;
  }
  // A line drawn in place of its source (the rule): a block replacement
  // that carries a drawing of its own.
  function ruleLineAt(state, pos) {
    const field = state.field(renderField, false);
    if (!field) return false;
    let found = false;
    field.between(pos, pos, function (from, to, deco) {
      if (deco.block && deco.isReplace && deco.widget && !(deco.widget instanceof BlockCoverWidget) && from <= pos && pos <= to) found = true;
    });
    return found;
  }
  // A line taken out of the flow by a block replacement, whether covered
  // (hidden source) or drawn in its place (the rule): no row the caret can
  // be put on by line number.
  function replacedLineAt(state, pos) {
    const field = state.field(renderField, false);
    if (!field) return false;
    let found = false;
    field.between(pos, pos, function (from, to, deco) {
      if (deco.block && deco.isReplace && from <= pos && pos <= to) found = true;
    });
    return found;
  }

  // ArrowDown and ArrowUp (with Shift, extending). CodeMirror's own move
  // steps half a text height past the caret's box and reads what is there,
  // which is right for rows of text and wrong for the 16 px blank rows
  // between paragraphs once the caret's box is taller than its row: in the
  // roman the box of an empty line is the text's line height and stands
  // out of its 16 px, so the step cleared the blank row under a heading and
  // the second of two blank lines, and the caret could never be put on
  // them (G102). A drawn row that the move would skip, shorter than a line
  // of text, is taken by line number instead, at the column the caret was
  // at, and the goal column is kept for the move after it.
  function stepIntoBlock(dir, extend) {
    return function (v) {
      const sel = v.state.selection;
      if (sel.ranges.length !== 1) return false;
      const main = sel.main;
      const line = v.state.doc.lineAt(main.head);
      // A wrapped paragraph is one document line but several visual rows.
      // The hidden block may therefore be the next document line while an
      // ordinary vertical move still belongs inside the paragraph. Let
      // CodeMirror make that move; only take over at the paragraph's visual
      // edge, where its own move leaves this document line.
      const natural = v.moveVertically(main, dir > 0);
      if (v.state.doc.lineAt(natural.head).number === line.number) return false;
      const n = line.number + dir;
      if (n < 1 || n > v.state.doc.lines) return false;
      const target = v.state.doc.line(n);
      const col = main.head - line.from;
      if (
        v.state.doc.lineAt(natural.head).number !== n &&
        !replacedLineAt(v.state, target.from) &&
        v.lineBlockAt(target.from).height < v.defaultLineHeight
      ) {
        const pos = Math.min(target.from + col, target.to);
        let goal = main.goalColumn;
        if (goal === undefined) {
          const at = v.coordsAtPos(main.head, main.assoc || -1);
          if (at) goal = at.left - v.contentDOM.getBoundingClientRect().left;
        }
        const range = extend
          ? CM.EditorSelection.range(main.anchor, pos, goal)
          : CM.EditorSelection.cursor(pos, natural.assoc, undefined, goal);
        // As a selection and not as a bare range: of a bare range the
        // transaction reads anchor and head alone, and the goal goes.
        v.dispatch({
          selection: CM.EditorSelection.create([range]),
          scrollIntoView: true,
          userEvent: "select",
        });
        return true;
      }
      if (extend || !main.empty) return false;
      // A rule drawn between the caret and the block is walked past, as the
      // arrow keys always did, and the block beyond it is still stepped into
      // (G101: the neighbouring line alone was asked, and a rule glued to a
      // table or a score shielded the whole of it).
      let beyond = target;
      for (let m = n; ruleLineAt(v.state, beyond.from) && m + dir >= 1 && m + dir <= v.state.doc.lines; ) {
        m += dir;
        beyond = v.state.doc.line(m);
      }
      const block = hiddenBlockAt(v.state, dir > 0 ? beyond.from : beyond.to);
      if (!block) return false;
      const into = dir > 0 ? v.state.doc.lineAt(block.from) : v.state.doc.lineAt(block.to);
      const pos = Math.min(into.from + col, into.to);
      v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      return true;
    };
  }

  // Ctrl+Alt+Up/Down: a caret on the line above or below every caret there
  // is, in the same column, the way VS Code adds them. The new carets join
  // the selection rather than replace it.
  function addCaretVertically(dir) {
    return function (v) {
      const sel = v.state.selection;
      const added = [];
      sel.ranges.forEach(function (range) {
        const moved = v.moveVertically(range, dir > 0);
        if (moved.head !== range.head) added.push(CM.EditorSelection.cursor(moved.head));
      });
      if (!added.length) return true;
      v.dispatch({
        selection: CM.EditorSelection.create(sel.ranges.concat(added), sel.mainIndex),
        scrollIntoView: true,
      });
      return true;
    };
  }

  // ---------- Enter ----------

  // Enter is the editor's own. CodeMirror's two commands for it, the markup
  // continuation of @codemirror/lang-markdown (lists and quotes) and
  // insertNewlineAndIndent, read whitespace with \s, which takes U+00A0,
  // U+2003 and U+3000 along with the space: a no-break space beside the
  // caret was deleted by one press of Enter, or written back as an ASCII
  // space through the indent (G088), and both readers that matter print it
  // (CommonMark 0.31.2 §2.1 counts only spaces and tabs as blank; Pandoc's
  // markdown gives `<p>&nbsp;</p>`). Below is that continuation with
  // `[ \t]` for its whitespace, and a plain newline with the same class, so
  // nothing but a space or a tab is ever taken. The shape (a tight list of
  // two made loose by an Enter on its second item, an empty item unnested
  // one level) is lang-markdown's, kept as it was; the gestures of P4 of the
  // branch change it on top of this.
  function isBlank(s) {
    return !/[^ \t]/.test(s);
  }

  // Columns up to `end`, a tab reaching the next multiple of four, which is
  // how CommonMark counts the indentation a marker stands at.
  function columnAt(s, end) {
    let col = 0;
    for (let i = 0; i < end && i < s.length; i++) {
      col = s.charCodeAt(i) === 9 ? col + 4 - (col % 4) : col + 1;
    }
    return col;
  }

  // One level of container markup around a line: the node (BulletList,
  // OrderedList or Blockquote), the columns its marker spans on the line the
  // item starts on, the space either side of the marker, the marker itself
  // and, for a list, the item.
  function MarkupLevel(node, from, to, spaceBefore, spaceAfter, type, item) {
    this.node = node;
    this.from = from;
    this.to = to;
    this.spaceBefore = spaceBefore;
    this.spaceAfter = spaceAfter;
    this.type = type;
    this.item = item;
  }
  // What a continuation line carries at this level: the quote's `>`, or
  // the width of the list marker in spaces.
  MarkupLevel.prototype.blank = function (maxWidth, trailing) {
    let result = this.spaceBefore + (this.node.name === "Blockquote" ? ">" : "");
    if (maxWidth != null) {
      while (result.length < maxWidth) result += " ";
      return result;
    }
    for (let i = this.to - this.from - result.length - this.spaceAfter.length; i > 0; i--) result += " ";
    return result + (trailing !== false ? this.spaceAfter : "");
  };
  // The marker of a new item at this level, numbered on from the item
  // before it in an ordered list.
  MarkupLevel.prototype.marker = function (doc, add) {
    const number = this.node.name === "OrderedList" ? String(+itemNumber(this.item, doc)[2] + add) : "";
    return this.spaceBefore + number + this.type + this.spaceAfter;
  };

  function itemNumber(item, doc) {
    return /^([ \t]*)(\d+)(?=[.)])/.exec(doc.sliceString(item.from, item.from + 10));
  }

  // The container levels around `node`, outermost first; none inside a
  // fenced block, whose lines are not Markdown.
  function markupLevels(node, doc) {
    const nodes = [];
    const levels = [];
    for (let cur = node; cur; cur = cur.parent) {
      if (cur.name === "FencedCode") return levels;
      if (cur.name === "ListItem" || cur.name === "Blockquote") nodes.push(cur);
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const line = doc.lineAt(n.from);
      const startPos = n.from - line.from;
      const rest = line.text.slice(startPos);
      let match;
      if (n.name === "Blockquote" && (match = /^ *>( ?)/.exec(rest))) {
        levels.push(new MarkupLevel(n, startPos, startPos + match[0].length, "", match[1], ">", null));
      } else if (
        n.name === "ListItem" &&
        n.parent.name === "OrderedList" &&
        // A task box on an ordered item too, and a tab after the marker,
        // both of which lang-markdown's own reading left out (G084).
        (match = /^([ \t]*)\d+([.)])( {1,4}\[[ xX]\])?([ \t]*)/.exec(rest))
      ) {
        let after = match[4];
        let len = match[0].length;
        if (after.length >= 4) {
          after = after.slice(0, after.length - 4);
          len -= 4;
        }
        let type = match[2];
        if (match[3]) type += match[3].replace(/[xX]/, " ");
        levels.push(new MarkupLevel(n.parent, startPos, startPos + len, match[1], after, type, n));
      } else if (
        n.name === "ListItem" &&
        n.parent.name === "BulletList" &&
        (match = /^([ \t]*)([-+*])( {1,4}\[[ xX]\])?([ \t]+)/.exec(rest))
      ) {
        let after = match[4];
        let len = match[0].length;
        if (after.length > 4) {
          after = after.slice(0, after.length - 4);
          len -= 4;
        }
        let type = match[2];
        if (match[3]) type += match[3].replace(/[xX]/, " ");
        levels.push(new MarkupLevel(n.parent, startPos, startPos + len, match[1], after, type, n));
      }
    }
    return levels;
  }

  // The items after `after` renumbered to follow it, as long as they were
  // in sequence; `offset` shifts them.
  function renumberList(after, doc, changes, offset) {
    for (let prev = -1, node = after; ; ) {
      if (node.name === "ListItem") {
        const m = itemNumber(node, doc);
        const number = +m[2];
        if (prev >= 0) {
          if (number !== prev + 1) return;
          changes.push({
            from: node.from + m[1].length,
            to: node.from + m[0].length,
            insert: String(prev + 2 + (offset || 0)),
          });
        }
        prev = number;
      }
      const next = node.nextSibling;
      if (!next) break;
      node = next;
    }
  }

  // A list whose first two items have a blank line between them is loose,
  // and a new item gets a blank line of its own.
  function nonTightList(node, doc) {
    if (node.name !== "OrderedList" && node.name !== "BulletList") return false;
    const first = node.firstChild;
    const second = node.getChild("ListItem", "ListItem");
    if (!second) return false;
    const line1 = doc.lineAt(first.to);
    const line2 = doc.lineAt(second.from);
    const empty = /^[ \t>]*$/.test(line1.text);
    return line1.number + (empty ? 0 : 1) < line2.number;
  }

  // The blank line a loose list puts between items, with the outer
  // containers' own marks on it.
  function blankLine(levels, line) {
    let insert = "";
    for (let i = 0, e = levels.length - 2; i <= e; i++) {
      insert += levels[i].blank(i < e ? columnAt(line.text, levels[i + 1].from) - insert.length : null, i < e);
    }
    return insert;
  }

  // The fenced block around a position, or null.
  function fenceAround(tree, pos) {
    for (let n = tree.resolveInner(pos, -1); n; n = n.parent) {
      if (n.name === "FencedCode") return n;
    }
    return null;
  }

  // The ATX heading around a position, or null, and where its text starts:
  // past the opening marks and the spaces or tabs after them.
  function headingAround(tree, pos) {
    for (let n = tree.resolveInner(pos, -1); n; n = n.parent) {
      if (/^ATXHeading[1-6]$/.test(n.name)) return n;
    }
    return null;
  }
  function headingTextStart(heading, doc) {
    const mark = heading.getChild("HeaderMark");
    if (!mark) return -1;
    const line = doc.lineAt(mark.from);
    let at = mark.to;
    while (at < line.to && /[ \t]/.test(doc.sliceString(at, at + 1))) at++;
    return at;
  }

  // The plain newline for one range: the line's own indentation carried on
  // (CommonMark reads it, for an indented code block or a continuation),
  // spaces and tabs after the caret taken, a prefix of spaces and tabs alone
  // taken with them, and nothing else touched. CodeMirror's own also opens a
  // pair of brackets onto three lines; in Markdown `[]` is a label, and that
  // is not done here.
  function plainNewline(state, range) {
    let from = range.from;
    let to = range.to;
    const line = state.doc.lineAt(from);
    const indent = /^[ \t]*/.exec(line.text)[0];
    while (to < line.to && /[ \t]/.test(line.text[to - line.from])) to++;
    if (from > line.from && from < line.from + 100 && isBlank(line.text.slice(0, from - line.from))) {
      from = line.from;
    }
    const insert = state.lineBreak + indent;
    return {
      changes: { from: from, to: to, insert: insert },
      range: CM.EditorSelection.cursor(from + insert.length),
    };
  }

  // The marks a continuation line carries at the given levels: the `>` of
  // each quote, the width of each list marker.
  function continuationPrefix(levels, line) {
    let prefix = "";
    for (let i = 0, e = levels.length - 1; i <= e; i++) {
      prefix += levels[i].blank(i < e ? columnAt(line.text, levels[i + 1].from) - prefix.length : null);
    }
    return prefix;
  }

  // Enter, range by range (G072: a caret outside any markup used to send
  // every caret to the plain newline). Inside a list or a quote the next
  // line carries the marks (a new item, numbered on; the `>`); an empty item
  // is unnested one level when a list holds this one, and unmade otherwise,
  // with a blank line put between it and the item before so that what is
  // typed next is a paragraph and not a lazy continuation of that item
  // (G068), and never made loose first (G069); an empty quoted line after
  // another closes the quote. Enter at the head of a heading's text opens
  // a line above it (G073). In a fence inside a quote or an item the new
  // line carries the container's marks, which CodeMirror's own newline
  // knew nothing of (G071). Anywhere else, the plain newline.
  function continueMarkup(view) {
    const state = view.state;
    if (state.readOnly) return false;
    const tree = CM.syntaxTree(state);
    const doc = state.doc;
    const changes = state.changeByRange(function (range) {
      if (!range.empty) return plainNewline(state, range);
      const pos = range.from;
      const line = doc.lineAt(pos);
      // The fence is asked before the language: inside a fence of
      // JavaScript the language at the caret is JavaScript, and the quote's
      // or the item's marks are still owed to the new line.
      const fence = fenceAround(tree, pos);
      if (fence) {
        // An item's marks up to where its content starts and not past a
        // task box: past it, a fence in a task wrote four spaces of its own
        // into every line of its code, and a score's `X:1` stood indented.
        const outer = markupLevels(fence.parent, doc);
        const prefix = blockPrefix(outer, line);
        const own = /^[ \t]*/.exec(line.text.slice(prefix.length))[0];
        const insert = state.lineBreak + prefix + own;
        return { changes: { from: pos, insert: insert }, range: CM.EditorSelection.cursor(pos + insert.length) };
      }
      if (
        !CM.markdownLanguage.isActiveAt(state, pos, -1) &&
        !CM.markdownLanguage.isActiveAt(state, pos, 1)
      ) {
        return plainNewline(state, range);
      }
      const heading = headingAround(tree, pos);
      if (heading && pos === headingTextStart(heading, doc) && pos > line.from) {
        return {
          changes: { from: line.from, insert: state.lineBreak },
          range: CM.EditorSelection.cursor(pos + state.lineBreak.length),
        };
      }
      const levels = markupLevels(tree.resolveInner(pos, -1), doc);
      while (levels.length && levels[levels.length - 1].from > pos - line.from) levels.pop();
      if (!levels.length) return plainNewline(state, range);
      const inner = levels[levels.length - 1];
      if (inner.to - inner.spaceAfter.length > pos - line.from) return plainNewline(state, range);
      const emptyLine = pos >= inner.to - inner.spaceAfter.length && isBlank(line.text.slice(inner.to));
      if (inner.item && emptyLine) {
        if (inner.item.from < line.from && !/^[ \t>]*$/.test(line.text.slice(0, inner.to))) {
          return plainNewline(state, range);
        }
        const next = levels.length > 1 ? levels[levels.length - 2] : null;
        const out = [];
        let delTo;
        let insert;
        if (next && next.item) {
          // Unnested: an item of the list one level out.
          delTo = line.from + next.from;
          insert = next.marker(doc, 1);
        } else {
          // Unmade: the marker goes, and the caret's line is parted from the
          // item before by a blank line unless one is there already.
          delTo = line.from + (next ? next.to : 0);
          const prevBlank = line.from > 0 && !/[^ \t>]/.test(doc.lineAt(line.from - 1).text);
          insert = prevBlank ? "" : state.lineBreak + (next ? next.blank(null, true) : "");
        }
        out.push({ from: delTo, to: pos, insert: insert });
        if (inner.node.name === "OrderedList") renumberList(inner.item, doc, out, -2);
        if (next && next.item && next.node.name === "OrderedList") renumberList(next.item, doc, out);
        return { range: CM.EditorSelection.cursor(delTo + insert.length), changes: out };
      }
      if (inner.node.name === "Blockquote" && emptyLine && line.from) {
        const prevLine = doc.lineAt(line.from - 1);
        const quoted = />[ \t]*$/.exec(prevLine.text);
        // Two empty quoted lines in a row, aligned: both go, the quote ends.
        if (quoted && quoted.index === inner.from) {
          const out = state.changes([
            { from: prevLine.from + quoted.index, to: prevLine.to },
            { from: line.from + inner.from, to: line.to },
          ]);
          return { range: range.map(out), changes: out };
        }
      }
      const out = [];
      if (inner.node.name === "OrderedList") renumberList(inner.item, doc, out);
      const continued = inner.item && inner.item.from < line.from;
      let insert = "";
      // Not dedented: the marks again, the innermost as a new item.
      if (!continued || /^[ \t\d.)\-+*>]*/.exec(line.text)[0].length >= inner.to) {
        for (let i = 0, e = levels.length - 1; i <= e; i++) {
          insert +=
            i === e && !continued
              ? levels[i].marker(doc, 1)
              : levels[i].blank(i < e ? columnAt(line.text, levels[i + 1].from) - insert.length : null);
        }
      }
      let from = pos;
      while (from > line.from && /[ \t]/.test(line.text.charAt(from - line.from - 1))) from--;
      if (nonTightList(inner.node, doc)) insert = blankLine(levels, line) + state.lineBreak + insert;
      out.push({ from: from, to: pos, insert: state.lineBreak + insert });
      return { range: CM.EditorSelection.cursor(from + insert.length + 1), changes: out };
    });
    view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
    return true;
  }

  // Inside a fence that no quote or item holds, the code's own language may
  // have an indentation to offer (a fence of JavaScript), and the whitespace
  // there is ASCII, so CodeMirror's own command keeps that job; a fence
  // inside a container needs the container's marks on the new line, which
  // continueMarkup writes.
  function mdmEnter(view) {
    const state = view.state;
    const tree = CM.syntaxTree(state);
    const bare = state.selection.ranges.every(function (r) {
      const fence = fenceAround(tree, r.from);
      return fence && !markupLevels(fence.parent, state.doc).length;
    });
    if (bare) return CM.insertNewlineAndIndent(view);
    return continueMarkup(view);
  }

  // ---------- Backspace and Delete ----------

  // The node the markup context of a deletion is read from: lang-markdown's
  // own reading, ported (a caret right after a mark reads the mark's
  // parent; a list before the position reads its last item).
  function isMark(node) {
    return node.name === "QuoteMark" || node.name === "ListMark";
  }
  function contextNodeForDelete(tree, pos) {
    let node = tree.resolveInner(pos, -1);
    let scan = pos;
    if (isMark(node)) {
      scan = node.from;
      node = node.parent;
    }
    for (let prev; (prev = node.childBefore(scan)); ) {
      if (isMark(prev)) {
        scan = prev.from;
      } else if (prev.name === "OrderedList" || prev.name === "BulletList") {
        node = prev.lastChild;
        scan = node.to;
      } else {
        break;
      }
    }
    return node;
  }

  // What rides on an emoji and is deleted with it by a text control (the
  // same Chrome's textarea takes the whole cluster): a skin tone, a keycap,
  // the variation selector, the joiner, a tag character (G056). A combining
  // accent is not among them: CodeMirror, the textarea and VS Code all take
  // the accent alone off an `e`.
  function emojiExtender(cp) {
    return (
      (cp >= 0x1f3fb && cp <= 0x1f3ff) ||
      cp === 0x20e3 ||
      cp === 0xfe0f ||
      cp === 0x200d ||
      (cp >= 0xe0020 && cp <= 0xe007f)
    );
  }
  function codePointBefore(text, col) {
    if (col <= 0) return -1;
    const low = text.charCodeAt(col - 1);
    if (col >= 2 && low >= 0xdc00 && low <= 0xdfff) {
      const high = text.charCodeAt(col - 2);
      if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(col - 2);
    }
    return low;
  }

  // Backspace, the editor's own. At the head of the line under a hidden
  // block (a fence, a score, an equation, a table, a figure) the block
  // opens and nothing is deleted, where the line break used to go into the
  // hidden fence and break the block (G062). After the marks of a heading
  // the whole run goes and the heading is a paragraph, as a list item loses
  // its whole marker (G077, decided for P4 of the branch). After the marker
  // of a list item or the `>` of a quote the marker goes whole, and when
  // the line before holds text a blank line parts them, so that the text
  // left is a paragraph, after the list or inside the item around it, and
  // not a lazy continuation of the item before, which the readers join into
  // that item's line (G078; lang-markdown blanked the marker with spaces
  // instead). An emoji with a skin tone or a keycap goes whole (G056).
  // Anything else is CodeMirror's own deletion.
  function mdmBackspace(view) {
    const state = view.state;
    if (state.readOnly) return false;
    const tree = CM.syntaxTree(state);
    const doc = state.doc;
    let special = false;
    const changes = state.changeByRange(function (range) {
      const plain = function () {
        // CodeMirror's own step back for this range, for a mixed selection.
        if (!range.empty) return { range: CM.EditorSelection.cursor(range.from), changes: { from: range.from, to: range.to } };
        const pos = range.from;
        if (pos === 0) return { range: range };
        const line = doc.lineAt(pos);
        const from = pos === line.from ? pos - state.lineBreak.length : line.from + CM.findClusterBreak(line.text, pos - line.from, false);
        return { range: CM.EditorSelection.cursor(from), changes: { from: from, to: pos } };
      };
      if (!range.empty) return plain();
      const pos = range.from;
      const line = doc.lineAt(pos);
      if (pos === line.from && pos > 0) {
        const block = hiddenBlockAt(state, pos - 1);
        if (block) {
          special = true;
          return { range: CM.EditorSelection.cursor(doc.lineAt(block.to).to) };
        }
      }
      const heading = headingAround(tree, pos);
      if (heading) {
        const mark = heading.getChild("HeaderMark");
        if (mark && pos === headingTextStart(heading, doc) && pos > mark.from) {
          special = true;
          return { range: CM.EditorSelection.cursor(mark.from), changes: { from: mark.from, to: pos } };
        }
      }
      if (CM.markdownLanguage.isActiveAt(state, pos)) {
        const levels = markupLevels(contextNodeForDelete(tree, pos), doc);
        if (levels.length) {
          const inner = levels[levels.length - 1];
          const spaceEnd = inner.to - inner.spaceAfter.length + (inner.spaceAfter ? 1 : 0);
          const col = pos - line.from;
          // Extra space after the markup: back to the one space.
          if (col > spaceEnd && !/\S/.test(line.text.slice(spaceEnd, col))) {
            special = true;
            return { range: CM.EditorSelection.cursor(line.from + spaceEnd), changes: { from: line.from + spaceEnd, to: pos } };
          }
          if (
            col === spaceEnd &&
            ((inner.item && line.from <= inner.item.from) || /^[ \t>]*$/.test(line.text.slice(0, inner.to)))
          ) {
            special = true;
            const prefix = line.text.slice(0, inner.from);
            const prevText = line.from > 0 && /[^ \t>]/.test(doc.lineAt(line.from - 1).text);
            const insert = prevText ? prefix.replace(/[ \t]+$/, "") + state.lineBreak + prefix : prefix;
            const out = [{ from: line.from, to: pos, insert: insert }];
            if (inner.item && inner.node.name === "OrderedList") renumberList(inner.item, doc, out, -2);
            return { range: CM.EditorSelection.cursor(line.from + insert.length), changes: out };
          }
        }
      }
      if (pos > line.from && emojiExtender(codePointBefore(line.text, pos - line.from))) {
        special = true;
        const from = line.from + CM.findClusterBreak(line.text, pos - line.from, false, true);
        return { range: CM.EditorSelection.cursor(from), changes: { from: from, to: pos } };
      }
      return plain();
    });
    if (!special) return false;
    view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "delete" }));
    return true;
  }

  // Delete at the end of the line over a hidden block: the block opens and
  // nothing is deleted (G062). Anything else is CodeMirror's own.
  function mdmDelete(view) {
    const state = view.state;
    const sel = state.selection;
    if (sel.ranges.length !== 1 || !sel.main.empty) return false;
    const pos = sel.main.head;
    const line = state.doc.lineAt(pos);
    if (pos !== line.to || pos >= state.doc.length) return false;
    const block = hiddenBlockAt(state, pos + 1);
    if (!block) return false;
    view.dispatch({ selection: { anchor: state.doc.lineAt(block.from).from }, scrollIntoView: true });
    return true;
  }

  // ---------- Tab and Shift+Tab ----------

  // The innermost list item around a position, when the position's own
  // container is that item and not a quote inside it; read from the left
  // of the position and, at the head of the marker's line, from its right.
  function itemAround(tree, doc, pos) {
    for (const side of [-1, 1]) {
      const levels = markupLevels(tree.resolveInner(pos, side), doc);
      const inner = levels.length ? levels[levels.length - 1] : null;
      if (inner && inner.item) return inner.item;
    }
    return null;
  }

  // The content column of an item: past its marker and the one to four
  // spaces after it, or one past the marker when five or more follow (an
  // indented code block) or none (the content on the next line). A child
  // block of the item stands at that column (CommonMark 5.2), which is
  // 2 for `- ` and 3 for `1. `.
  function contentColumn(item, doc) {
    const line = doc.lineAt(item.from);
    const mark = item.getChild("ListMark");
    const end = (mark ? mark.to : item.from + 1) - line.from;
    let sp = end;
    while (sp < line.text.length && /[ \t]/.test(line.text[sp])) sp++;
    const column = columnAt(line.text, end);
    if (sp === end || sp === line.text.length || columnAt(line.text, sp) - column >= 5) return column + 1;
    return columnAt(line.text, sp);
  }

  // The index in `text` at which `column` is reached, or the text's length.
  function indexAtColumn(text, column) {
    let i = 0;
    while (i < text.length && columnAt(text, i) < column) i++;
    return i;
  }

  // The items a range takes along: the one at its head and, when the range
  // reaches into later siblings, those too; their lines run from the first
  // marker to the end of the last item, children included.
  function itemBlock(tree, doc, range) {
    const first = itemAround(tree, doc, range.from);
    if (!first) return null;
    let last = first;
    for (let n = first.nextSibling; n && n.from < range.to; n = n.nextSibling) {
      if (n.name === "ListItem") last = n;
    }
    let endLine = doc.lineAt(last.to);
    if (endLine.from === last.to && last.to > last.from) endLine = doc.lineAt(last.to - 1);
    return { first: first, last: last, fromLine: doc.lineAt(first.from), endLine: endLine };
  }

  // The marker of `item` and the items after it in their list rewritten:
  // numbered from `start` on in an ordered list, `bullet` when given (the
  // items joining a list of the other kind), as far as the list was
  // numbered in steps of one (a list written all `1.` keeps its ones), and
  // no further than `last` when given.
  function remarkItems(item, doc, changes, start, bullet, last) {
    let prev = null;
    for (let n = item, k = start; n; n = n.nextSibling) {
      if (n.name !== "ListItem") continue;
      const mark = n.getChild("ListMark");
      if (!mark) return;
      const m = itemNumber(n, doc);
      if (bullet) {
        changes.push({ from: n.from, to: mark.to, insert: bullet });
      } else {
        if (!m) return;
        if (prev !== null && +m[2] !== prev + 1) return;
        prev = +m[2];
        if (+m[2] !== k) changes.push({ from: n.from + m[1].length, to: n.from + m[0].length, insert: String(k) });
        k++;
      }
      if (n === last) return;
    }
  }

  // The marker an item takes when it joins `list`: its own kind kept, or
  // the bullet of `list` when that is a bullet list and the item is not.
  function bulletOf(list, item, doc) {
    if (list.name !== "BulletList" || item.parent.name === "BulletList") return null;
    const mark = list.firstChild && list.firstChild.getChild("ListMark");
    return mark ? doc.sliceString(mark.from, mark.to) : "-";
  }

  // The nested list an item ends with, at its content column, or null.
  function nestedListOf(item, doc) {
    const tail = item.lastChild;
    if (!tail || (tail.name !== "OrderedList" && tail.name !== "BulletList")) return null;
    const line = doc.lineAt(tail.from);
    return columnAt(line.text, tail.from - line.from) === contentColumn(item, doc) ? tail : null;
  }

  // Whether a line of an item's block can move: not blank (a line of
  // spaces would be left behind), and holding nothing but marks and space
  // before the column the marker stands at (a lazy continuation at the
  // margin stays where it is, and stays a continuation).
  function movable(line, at, column) {
    return !/^[ \t>]*$/.test(line.text) && /^[ \t>]*$/.test(line.text.slice(0, at)) && columnAt(line.text, at) === column;
  }

  // Tab on an item: the item, its children and the selected siblings after
  // it move under the item above, at that item's content column (G070:
  // the plain indent put two spaces under `1. `, which no reader nests,
  // and left the children behind). In an ordered list the block is
  // numbered from one, or on from the nested list the item above ends
  // with, and the items left behind close up.
  function nestItems(state, tree, range, taken) {
    const doc = state.doc;
    const block = itemBlock(tree, doc, range);
    if (!block || taken.has(block.first.from)) return null;
    taken.add(block.first.from);
    let prev = block.first.prevSibling;
    while (prev && prev.name !== "ListItem") prev = prev.prevSibling;
    if (!prev) return null;
    const column = columnAt(block.fromLine.text, block.first.from - block.fromLine.from);
    const delta = contentColumn(prev, doc) - column;
    if (delta <= 0) return null;
    const pad = " ".repeat(delta);
    const changes = [];
    for (let n = block.fromLine.number; n <= block.endLine.number; n++) {
      const line = doc.line(n);
      const at = indexAtColumn(line.text, column);
      if (movable(line, at, column)) changes.push({ from: line.from + at, insert: pad });
    }
    const nested = nestedListOf(prev, doc);
    const ordered = block.first.parent.name === "OrderedList";
    if (nested && nested.name === "OrderedList") {
      remarkItems(block.first, doc, changes, +itemNumber(nested.lastChild, doc)[2] + 1, null, block.last);
    } else if (nested) {
      remarkItems(block.first, doc, changes, 1, bulletOf(nested, block.first, doc), block.last);
    } else if (ordered) {
      remarkItems(block.first, doc, changes, 1, null, block.last);
    }
    if (ordered && block.last.nextSibling) {
      remarkItems(block.last.nextSibling, doc, changes, +itemNumber(block.first, doc)[2], null);
    }
    const set = state.changes(changes);
    return { changes: set, range: range.map(set) };
  }

  // Shift+Tab on a nested item: the block moves out to the column of the
  // item that held it, right after that item; the siblings it leaves
  // behind stay where they are, so those after it become its children. In
  // an ordered list the numbers follow.
  function unnestItems(state, tree, range, taken) {
    const doc = state.doc;
    const block = itemBlock(tree, doc, range);
    if (!block || taken.has(block.first.from)) return null;
    taken.add(block.first.from);
    const list = block.first.parent;
    const parent = list.parent;
    if (!parent || parent.name !== "ListItem") return null;
    const column = columnAt(block.fromLine.text, block.first.from - block.fromLine.from);
    const parentLine = doc.lineAt(parent.from);
    const target = columnAt(parentLine.text, parent.from - parentLine.from);
    if (column <= target) return null;
    const changes = [];
    for (let n = block.fromLine.number; n <= block.endLine.number; n++) {
      const line = doc.line(n);
      const to = indexAtColumn(line.text, column);
      const from = indexAtColumn(line.text, target);
      if (movable(line, to, column) && isBlank(line.text.slice(from, to))) changes.push({ from: line.from + from, to: line.from + to });
    }
    const outer = parent.parent;
    let count = 0;
    for (let n = block.first; n; n = n.nextSibling) {
      if (n.name === "ListItem") count++;
      if (n === block.last) break;
    }
    if (outer.name === "OrderedList") {
      const number = +itemNumber(parent, doc)[2];
      remarkItems(block.first, doc, changes, number + 1, null, block.last);
      if (parent.nextSibling) remarkItems(parent.nextSibling, doc, changes, number + 1 + count, null);
    } else {
      remarkItems(block.first, doc, changes, 1, bulletOf(outer, block.first, doc), block.last);
    }
    if (list.name === "OrderedList" && block.last.nextSibling) remarkItems(block.last.nextSibling, doc, changes, 1, null);
    const set = state.changes(changes);
    return { changes: set, range: range.map(set) };
  }

  // Tab, the editor's own. In a fence, the code's indentation: the unit at
  // the caret, or at the head of each selected line. In an item, the
  // nesting above. In prose, a tab at the caret in the middle of a line,
  // and nothing at the head of the line's text, where four columns of
  // indentation would make an indented code block of the paragraph (G070);
  // nothing either on a selection, or on an item that has nothing to nest
  // under. The key is always taken: an unhandled Tab moves the focus out
  // of the editor.
  function mdmTab(view) {
    const state = view.state;
    if (state.readOnly) return false;
    const tree = CM.syntaxTree(state);
    const doc = state.doc;
    const unit = state.facet(CM.indentUnit);
    const taken = new Set();
    let changed = false;
    const changes = state.changeByRange(function (range) {
      if (fenceAround(tree, range.from)) {
        const out = [];
        if (range.empty) {
          out.push({ from: range.from, insert: unit });
        } else {
          const last = doc.lineAt(range.to);
          for (let n = doc.lineAt(range.from).number; n <= last.number; n++) out.push({ from: doc.line(n).from, insert: unit });
        }
        const set = state.changes(out);
        changed = true;
        return { changes: set, range: range.map(set, 1) };
      }
      const nested = nestItems(state, tree, range, taken);
      if (nested) {
        changed = true;
        return nested;
      }
      if (itemAround(tree, doc, range.from)) return { range: range };
      const line = doc.lineAt(range.from);
      if (!range.empty || /^[ \t>]*$/.test(line.text.slice(0, range.from - line.from))) return { range: range };
      changed = true;
      return { changes: { from: range.from, insert: "\t" }, range: CM.EditorSelection.cursor(range.from + 1) };
    });
    if (changed) view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input.indent" }));
    return true;
  }

  // Shift+Tab: in a fence, one unit of indentation off each line of the
  // range; in a nested item, the unnesting above; nothing anywhere else.
  function mdmShiftTab(view) {
    const state = view.state;
    if (state.readOnly) return false;
    const tree = CM.syntaxTree(state);
    const doc = state.doc;
    const unit = state.facet(CM.indentUnit);
    const taken = new Set();
    let changed = false;
    const changes = state.changeByRange(function (range) {
      if (fenceAround(tree, range.from)) {
        const out = [];
        const last = doc.lineAt(range.to);
        for (let n = doc.lineAt(range.from).number; n <= last.number; n++) {
          const line = doc.line(n);
          let i = 0;
          let col = 0;
          while (i < line.text.length && col < unit.length && /[ \t]/.test(line.text[i])) {
            col += line.text[i] === "\t" ? state.tabSize - (col % state.tabSize) : 1;
            i++;
          }
          if (i) out.push({ from: line.from, to: line.from + i });
        }
        const set = state.changes(out);
        changed = changed || out.length > 0;
        return { changes: set, range: range.map(set) };
      }
      const unnested = unnestItems(state, tree, range, taken);
      if (unnested) {
        changed = true;
        return unnested;
      }
      return { range: range };
    });
    if (changed) view.dispatch(state.update(changes, { scrollIntoView: true, userEvent: "delete.dedent" }));
    return true;
  }

  // ---------- Ctrl+D: next occurrence ----------

  // Ctrl+D matches whole words, the way VS Code does: a caret in "score" walks
  // the standalone "score"s and steps over "scores". The toolbar toggle turns
  // on substring matching, where "score" also lands inside "scores",
  // "scoreboard" and the like. Which of the two is in force is a setting
  // (mdm.multicursorMatch), so the toggle comes back lit as it was left.
  let matchSubstring = SETTINGS.multicursorMatch === "substring";

  // The substring form of selectNextOccurrence. The first press, on an empty
  // selection, takes the word under the caret (so the toggle can be flipped
  // mid-word); each press after adds the next literal run of that text,
  // wrapping and skipping the ones already in the selection.
  function selectNextSubstring(v) {
    const state = v.state;
    const sel = state.selection;
    const main = sel.main;
    if (main.empty) {
      const word = state.wordAt(main.head);
      if (!word) return false;
      v.dispatch({
        selection: CM.EditorSelection.create(
          sel.ranges.map(function (r) {
            return r === main ? word : r;
          }),
          sel.mainIndex
        ),
      });
      return true;
    }
    const query = state.sliceDoc(main.from, main.to);
    if (!query) return false;
    const doc = state.doc.toString();
    const matches = [];
    for (let i = doc.indexOf(query); i >= 0; i = doc.indexOf(query, i + 1)) {
      matches.push(i);
    }
    const taken = new Set(
      sel.ranges.filter(function (r) {
        return !r.empty;
      }).map(function (r) {
        return r.from;
      })
    );
    const rightmost = sel.ranges.reduce(function (m, r) {
      return Math.max(m, r.to);
    }, 0);
    let pick = matches.find(function (m) {
      return m >= rightmost && !taken.has(m);
    });
    if (pick === undefined) {
      pick = matches.find(function (m) {
        return !taken.has(m);
      });
    }
    if (pick === undefined) return true; // every occurrence is already in
    const range = CM.EditorSelection.range(pick, pick + query.length);
    const ranges = sel.ranges.concat(range);
    v.dispatch({
      selection: CM.EditorSelection.create(ranges, ranges.length - 1),
      scrollIntoView: true,
    });
    return true;
  }

  // What Ctrl+D runs: the substring form while the toggle is on, CodeMirror's
  // own whole-word selectNextOccurrence otherwise.
  function selectNextOccurrenceMaybe(v) {
    return matchSubstring ? selectNextSubstring(v) : CM.selectNextOccurrence(v);
  }

  // Both sides of the toggle get their own text, the way the header button has
  // one for each state: what the tooltip names is what the click switches to,
  // not the state in use (the convention of the staff, alignment and header
  // buttons).
  function matchTip() {
    return matchSubstring
      ? "Multicursor matches whole words"
      : "Multicursor matches inside words";
  }

  function updateMatchButton() {
    const btn = document.querySelector('#app button[data-type="mdm-match-substring"]');
    if (!btn) return;
    btn.setAttribute("aria-label", matchTip());
    btn.classList.toggle("mdm-btn--on", matchSubstring);
  }

  // ---------- Tooltips ----------

  // A tooltip is drawn on :hover from aria-label (.mdm-tip in style.css), so
  // a button that changes what it says when it is clicked says the new thing
  // under the pointer that has not moved: the headphones flipped from "Hide
  // player" to "Show player" with the panel still open under them, and the
  // toolbar's tooltip, drawn southwards, covered the first entry of the panel
  // its own click had just opened. A click puts the tooltip away until the
  // pointer leaves and comes back, which is when the button has something new
  // to say. Nothing to put away if the pointer is not on the button (a button
  // worked from the keyboard): the mouseleave that restores it would never
  // come, and the next hover would show nothing.
  function hideTipUntilLeave(el) {
    if (!el || !el.matches || !el.matches(":hover")) return;
    el.classList.add("mdm-tip--off");
    const restore = function () {
      el.classList.remove("mdm-tip--off");
      el.removeEventListener("mouseleave", restore);
    };
    el.addEventListener("mouseleave", restore);
  }

  // One rule for the whole editor, in capture so that it is read before the
  // handlers that stop the click travelling (the block chrome, the player
  // bar). The copy button is the exception: its click has something to say,
  // so it holds the tooltip open for its own answer and puts it away itself
  // (copyBlock).
  function dismissTip(e) {
    const el = e.target && e.target.closest ? e.target.closest(".mdm-tip") : null;
    if (!el || el.classList.contains("mdm-copy")) return;
    hideTipUntilLeave(el);
  }

  // ---------- Mouse ----------

  // The click that adds a caret follows VS Code's editor.multiCursorModifier.
  // With "alt", Alt+click adds one and Shift+Alt+drag selects a column; with
  // "ctrlCmd", Ctrl+click adds one and Shift+Alt+drag still does the column
  // (CodeMirror's own, which is Alt+drag, would fight the column with the
  // caret under "alt").
  function addsCaret(e) {
    if (e.shiftKey) return false;
    return multiCursorModifier === "ctrlCmd" ? e.ctrlKey || e.metaKey : e.altKey;
  }

  // Alt+click has to reach this editor the way it reaches VS Code's own: the
  // first press was being eaten by the menu bar.
  //
  // What happens without this. VS Code focuses the menu bar (File, Edit, ...)
  // on a CLEAN press and release of Alt, and the workbench decides that in
  // ModifierKeyEmitter: the Alt keydown writes lastKeyPressed="alt", the
  // keyup writes lastKeyReleased="alt", and the two together are what the
  // menu bar reads. A press used with the mouse is not clean, and what says
  // so is a listener of its own on `document.body`, which clears
  // lastKeyPressed on every mousedown. That body is the workbench's: a click
  // made inside a webview never reaches it, so a held Alt here always looked
  // like a tap, and the release took the focus out of this page and into the
  // File menu. From the inside that reads as the multicursor breaking: the
  // caret WAS added by the click, and then the carets stopped being drawn and
  // the typing went to the menu bar, so the gesture only worked on the second
  // try, once the menu bar had been dismissed by another Alt.
  //
  // What is done about it. The tap must keep opening the File menu, so the
  // press is left alone and it is the RELEASE that is held back, and only
  // when the press was used with the mouse, which is the same rule the
  // workbench applies to itself. The keys leave the page through a bubble
  // listener the webview preload puts on the window (contentWindow
  // .addEventListener('keyup', handleInnerKeyup), in
  // workbench/contrib/webview/browser/pre/index.html), so stopping the event
  // on the way up at the document keeps it from ever being forwarded, while
  // everything inside the page has already had it. A key event of our own is
  // no use here: the host drops what it is sent unless event.isTrusted
  // (shouldForwardKeyEvent), and a dispatched one is never trusted.
  //
  // The workbench is left believing Alt is still down until the next key it
  // sees, which is the next character typed here, since every keydown writes
  // the modifier state afresh. Nothing reads that state in between but the
  // alternative actions some toolbars show while Alt is held.
  let altUsedWithMouse = false;

  function watchAltPresses() {
    document.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "Alt" && !e.repeat) altUsedWithMouse = false;
      },
      true
    );
    // Capture: a press inside the player bar is stopped there (openPlayer).
    document.addEventListener(
      "mousedown",
      function (e) {
        if (e.altKey) altUsedWithMouse = true;
      },
      true
    );
    // Bubble at the document, the last stop before the window: the editor and
    // every other listener in the page see this release, the host does not.
    document.addEventListener("keyup", function (e) {
      if (e.key !== "Alt" || !altUsedWithMouse) return;
      altUsedWithMouse = false;
      e.stopPropagation();
    });
  }

  // Inside VS Code, Ctrl+Z reaches this editor twice: once as the keydown,
  // which the keymap answers with CodeMirror's own undo, and once more as the
  // workbench's `undo` command, which the webview host replays into the page
  // as document.execCommand("undo") (the same for redo). The replay would run
  // the browser's native undo over CodeMirror's DOM, a second, blind undo on
  // top of the first (measured: it ate the end of the line). The two commands
  // are taken off execCommand; copy, paste, cut and selectAll keep theirs,
  // which CodeMirror answers through the events they fire.
  function disarmNativeHistory() {
    const native = document.execCommand.bind(document);
    document.execCommand = function (command) {
      if (command === "undo" || command === "redo") return true;
      return native.apply(document, arguments);
    };
  }

  // The run of characters of one kind (word, spaces, punctuation) around a
  // position, what CodeMirror's own double click selects: `wordAt` would
  // give nothing on a space or a `*`. `assoc` says which side of the
  // position the caret leans to, the side the press came from.
  function groupAt(state, pos, assoc) {
    const line = state.doc.lineAt(pos);
    if (line.length === 0) return CM.EditorSelection.cursor(pos);
    const text = line.text;
    const categorize = state.charCategorizer(pos);
    let at = pos - line.from;
    let bias = at === 0 ? 1 : at === text.length ? -1 : assoc < 0 ? -1 : 1;
    let from = at;
    let to = at;
    if (bias < 0) from = CM.findClusterBreak(text, at, false);
    else to = CM.findClusterBreak(text, at);
    const kind = categorize(text.slice(from, to));
    while (from > 0) {
      const prev = CM.findClusterBreak(text, from, false);
      if (categorize(text.slice(prev, from)) !== kind) break;
      from = prev;
    }
    while (to < text.length) {
      const next = CM.findClusterBreak(text, to);
      if (categorize(text.slice(to, next)) !== kind) break;
      to = next;
    }
    return CM.EditorSelection.range(line.from + from, line.from + to);
  }

  // The second and third press of a double and a triple click, answered
  // here rather than by CodeMirror. Its own reading takes the word under the
  // pointer, and by the second press the first has revealed the marks of
  // the construct it landed in and moved the text under a pointer that has
  // not moved: on a heading the `## ` shifts the word 65 px right, so the
  // word it read was the one before. The first press put the caret in the
  // word that was pointed at, on the layout the pointer was aimed at, so the
  // word (or the line, on the third press, with its line break as
  // CodeMirror takes it) is taken from the caret. Only plain presses on the
  // text: a modifier is a caret being added or a column drawn, and a widget
  // answers its own presses.
  function repeatedPress(e) {
    if (e.detail < 2 || e.button !== 0 || !view) return false;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
    if (e.target.closest(".mdm-score, .mdm-math, .mdm-table, .mdm-image, input")) return false;
    const state = view.state;
    const main = state.selection.main;
    let range;
    if (e.detail === 2) {
      range = groupAt(state, main.head, main.assoc);
    } else {
      const line = state.doc.lineAt(main.head);
      const to = line.to < state.doc.length ? line.to + 1 : line.to;
      range = CM.EditorSelection.range(line.from, to);
    }
    e.preventDefault();
    e.stopPropagation();
    view.dispatch({ selection: range, userEvent: "select.pointer" });
    return true;
  }

  // The end of the marker widget standing at `pos`: where the item's text
  // starts, past the marker as typed and the space after it.
  function markerEndAt(state, pos) {
    const field = state.field(renderField, false);
    if (!field) return null;
    let found = null;
    field.between(pos, pos, function (from, to, deco) {
      if (deco.widget instanceof MarkerWidget && from <= pos && pos <= to) found = to;
    });
    return found;
  }

  // The task marker of the item whose marker widget stands at `pos`, read
  // off the tree (G076: a regex knew `- [ ]` and `1. [ ]` at the head of
  // the line alone, so a box inside a quote or on a `2)` item was drawn and
  // did nothing when clicked).
  function taskMarkerAt(state, pos) {
    for (let n = CM.syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
      if (n.name === "ListItem") {
        const task = n.getChild("Task");
        return task ? task.getChild("TaskMarker") : null;
      }
    }
    return null;
  }

  // The click that follows a link is the one VS Code's own editor takes:
  // Ctrl+click (Cmd on a Mac), or Alt+click when editor.multiCursorModifier
  // is ctrlCmd and Ctrl+click adds a caret instead (G083).
  function followsLink(e) {
    if (e.shiftKey) return false;
    return multiCursorModifier === "ctrlCmd" ? e.altKey : e.ctrlKey || e.metaKey;
  }

  // The destination of the link drawn at `el`: the tooltip carries it for a
  // link with one, and an autolink or a bare address is its own text, an
  // address without a scheme that holds an `@` being mail.
  function hrefOf(el) {
    const title = el.getAttribute("title");
    if (title) return title;
    let node = CM.syntaxTree(view.state).resolveInner(view.posAtDOM(el), 1);
    while (node && node.name !== "Autolink" && node.name !== "URL") node = node.parent;
    if (!node) return null;
    const text = view.state.sliceDoc(node.from, node.to).replace(/^<|>$/g, "");
    return !/^[a-z][a-z0-9+.-]*:/i.test(text) && text.indexOf("@") !== -1 ? "mailto:" + text : text;
  }

  // Pandoc's identifier for a heading, near enough: lowercased, punctuation
  // dropped, spaces to hyphens, and whatever leads before the first letter
  // gone; an identifier written on the heading itself (`{#id}`) wins.
  function headingSlug(text) {
    const own = /\{#([^}\s]+)[^}]*\}\s*$/.exec(text);
    if (own) return own[1].toLowerCase();
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_.-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/^[^\p{L}]+/u, "");
  }

  // A link to a heading of this document (`#scales`): the caret goes to the
  // heading, which is what the page does with the fragment. Nothing found,
  // nothing happens.
  function jumpToHeading(fragment) {
    let want;
    try {
      want = decodeURIComponent(fragment).toLowerCase();
    } catch (e) {
      want = fragment.toLowerCase();
    }
    const state = view.state;
    let target = null;
    CM.syntaxTree(state).iterate({
      enter: function (n) {
        if (target !== null) return false;
        if (!/^(ATXHeading[1-6]|SetextHeading[12])$/.test(n.name)) return;
        let from = n.from;
        let to = n.to;
        n.node.getChildren("HeaderMark").forEach(function (m) {
          if (m.from === from) from = m.to;
          else if (m.to === to || m.from >= from) to = Math.min(to, m.from);
        });
        if (headingSlug(state.sliceDoc(from, to).trim()) === want) target = from + /^[ \t]*/.exec(state.sliceDoc(from, to))[0].length;
        return false;
      },
    });
    if (target === null) return;
    view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
    view.focus();
  }

  // Mousedown on the chrome of a block (copy, player toggle), on a list
  // marker, and on a link with the follow modifier. Caught on the content
  // DOM in the capture phase: CodeMirror ignores events inside the widgets
  // (ignoreEvent), but the browser would still move the native selection to
  // the click, which CodeMirror then reads back as a caret landing in the
  // block; preventing the default keeps the caret where it was. The task
  // box flips the text it stands for, the bullet and the number put the
  // caret at the item's text (G066), and Ctrl+click on a link follows it: a
  // heading of this document by the caret, anything else through the host
  // (G083). A plain click on a link edits it, as in VS Code's own editor.
  function handleMouseDown(e) {
    if (!e.target.closest) return;
    if (e.target.closest(".mdm-chrome")) {
      e.preventDefault();
      return;
    }
    if (repeatedPress(e) || !view) return;
    const link = e.button === 0 && e.target.closest(".mdm-link");
    if (link && followsLink(e)) {
      e.preventDefault();
      const href = hrefOf(link);
      if (!href) return;
      if (href.charAt(0) === "#") jumpToHeading(href.slice(1));
      else vscode.postMessage({ type: "openLink", href: href });
      return;
    }
    const marker = e.target.closest(".mdm-li-marker");
    if (!marker) return;
    e.preventDefault();
    const pos = view.posAtDOM(marker);
    const box = e.target.closest("input.mdm-task");
    if (box) {
      const task = taskMarkerAt(view.state, pos);
      if (!task) return;
      const at = task.from + 1;
      const checked = /x/i.test(view.state.sliceDoc(at, at + 1));
      view.dispatch({ changes: { from: at, to: at + 1, insert: checked ? " " : "x" } });
      return;
    }
    const end = markerEndAt(view.state, pos);
    if (end === null) return;
    // The focus first: the default was prevented, so the browser gives the
    // editor none of its own, and the selection put in place below would
    // pull it in from inside the update, where syncFocus's dispatch on the
    // focus event is a call CodeMirror refuses.
    view.focus();
    view.dispatch({ selection: { anchor: end }, userEvent: "select.pointer" });
  }

  // ---------- Scores in widgets ----------

  // A score widget leaving the document (its source changed, or the block
  // went): the player that may be open on it follows the block by position,
  // from the observer below. Which widget it was is not asked, because it
  // cannot be answered here: the bar is in the toolbar and says nothing about
  // the score, and a node CodeMirror is throwing away has no position left to
  // read. A pass while a player is open costs a coalesced frame.
  function releaseScore() {
    if (player) scheduleAfterRender();
  }

  // Every role abcjs draws words with, at the size and the shape abcjs gives
  // it: the point size is abcjs 6.7.0's own default, which it draws at 4/3 (a
  // title at 20 pt comes out at 27 px). The sizes are not ours to move. They
  // were held to a ladder over the prose's x-height for a while and that was
  // taken back on 2026-09-10; what this table changes is the face and nothing
  // else, so a title stays at 27 px, a part label at 20, the lyric at 17 in
  // bold. The page and the paper carry the same table (resources/mdm.js and
  // chrome_page in mdm.lua), which is what keeps the three surfaces drawing
  // one document.
  //
  // headerfont and footerfont are in it for completeness and draw nothing
  // here: abcjs writes a %%header and a %%footer only in the print mode it
  // keeps for its own tunebooks, which nothing in this project asks for
  // (`e.header && o` in the bundle, where o is that flag).
  //
  // The third slot is the family, and it is there for the annotation. That
  // and the chord symbol are the two roles abcjs does not set in a Times,
  // and they want opposite things from the same swap. An annotation is a
  // word a player reads off the staff (cresc., dolce, poco a poco) and it is
  // lowercase, so what says how big it looks is the x-height, and Latin
  // Modern's is a fifth shorter than Helvetica's at the same nominal size:
  // the owner saw "cresc." come out as fine print beside the notes. It goes
  // in the wide family, which is the same four files scaled to the sans's
  // x-height with the line box held where it was. The stylesheet has the
  // numbers, and why a larger size in this table was not the answer: abcjs
  // reserves a row of text by its box, so 14.5 instead of 12 would have
  // bought the right x-height and a tenth more height with it.
  //
  // gchordfont takes the plain family at abcjs's own size, because a chord
  // is read off its capital and its figures and those already agree between
  // the two faces: "Cmaj7" comes out 46.22 px wide against Helvetica's
  // 46.23. In the wide family it was a fifth larger than abcjs draws it and
  // pushed the system wider to fit. It is in the table at the owner's word
  // of 2026-09-19, which closes the exception the first round of this left
  // open, and it takes the exported PDF with it: a face this table does not
  // name is resolved against the machine that exported, so a score of chord
  // symbols printed differently on two machines and now does not.
  //
  // Three roles are still missing, the three a tablature staff spends
  // (tablabelfont, tabnumberfont and tabgracefont, which abcjs gives
  // Trebuchet MS and Arial). Nothing here draws a tablature staff, and the
  // round that takes them should take the three together.
  const SCORE_TEXT_ROLES = {
    titlefont: [20, ""],
    subtitlefont: [16, ""],
    composerfont: [14, "italic"],
    partsfont: [15, ""],
    tempofont: [15, "bold"],
    vocalfont: [13, "bold"],
    voicefont: [13, "bold"],
    wordsfont: [16, ""],
    textfont: [16, ""],
    historyfont: [16, ""],
    infofont: [14, "italic"],
    measurefont: [14, "italic"],
    repeatfont: [13, ""],
    tripletfont: [11, "italic"],
    annotationfont: [12, "", "wide"],
    gchordfont: [12, ""],
    headerfont: [12, ""],
    footerfont: [12, ""],
  };

  // What abcjs is handed for the face, or nothing at all when the document is
  // in the sans and the engraving keeps the faces abcjs compiled in.
  //
  // A string and not an object: abcjs takes `{face, size}` without complaint
  // and writes font-family="[ object Object ]" into the SVG (6.7.0, measured).
  // The family arrives from the sheet already quoted, which is the form abcjs
  // parses for a name of several words.
  //
  // This goes in the parameters and NOT into the ABC source, though a
  // `%%titlefont` line prepended to the text sets exactly the same thing. The
  // source is the document: it is what a click opens, what the copy button
  // hands out and what the player renders, and every character offset into it
  // would shift by the length of whatever was prepended. A document that sets
  // its own `%%titlefont` still wins over this, because abcjs applies the
  // tune's own directives after the format it was handed (verified on 6.7.0).
  function scoreFormat() {
    if (!scoreFace || !scoreFaceWide || !scoreFacesIn) return null;
    const out = {};
    Object.keys(SCORE_TEXT_ROLES).forEach(function (role) {
      const spec = SCORE_TEXT_ROLES[role];
      const face = spec[2] === "wide" ? scoreFaceWide : scoreFace;
      out[role] = face + (spec[1] ? " " + spec[1] : "") + " " + spec[0];
    });
    return out;
  }

  // Engraves one score into its <code>. abcjs is loaded by the page before
  // this script (vendor/abcjs), so the engraving is synchronous; what needs
  // the block to be on screen (fitScores measures it) runs afterwards, from
  // the observer below.
  function renderScore(code, source) {
    try {
      if (!window.ABCJS) return;
      // The old drawing goes, and the engraver that walked it with it: this
      // is called a second time on a <code> that already has one (a change of
      // face), and a throw below would leave the player holding an engraver
      // whose elements are no longer in the page.
      SCORE_VISUALS.delete(code);
      code.innerHTML = "";
      const params = {
        add_classes: true,
        paddingtop: 2,
        paddingbottom: 2,
        paddingleft: 0,
        paddingright: 0,
      };
      const format = scoreFormat();
      if (format) params.format = format;
      const visual = ABCJS.renderAbc(code, source, params)[0];
      if (visual) SCORE_VISUALS.set(code, visual);
    } catch (e) {
      // Score rendering must never break editing.
    }
  }

  // Every score on screen, drawn again, which is what a change of face costs.
  // abcjs writes the family onto each <text> as it draws and lays the staff
  // out around the room those words take, so there is nothing to restyle
  // afterwards: a score in the wrong face is a score that has to be engraved
  // again. CodeMirror does the same thing for its own reasons whenever a
  // widget comes back into the viewport, so this is a path the player and the
  // playhead already live with (afterRender puts both back).
  function engraveScoresAgain() {
    let drawn = 0;
    document
      .querySelectorAll("code.language-abc")
      .forEach(function (code) {
        const block = code.closest("[data-mdm-source]");
        const source = block && block.getAttribute("data-mdm-source");
        if (typeof source !== "string") return;
        renderScore(code, source);
        drawn++;
      });
    // Nothing drawn, nothing to fit or to follow. The guard is not only
    // thrift: the first call of the session comes from applyTextFont before
    // the view is built, and afterRender reads the view.
    if (drawn) afterRender();
  }

  // After every change of the content DOM: scores that just appeared are
  // fitted and the player follows its block.
  let renderScheduled = false;
  function scheduleAfterRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(function () {
      renderScheduled = false;
      afterRender();
    });
  }
  function afterRender() {
    try {
      fitScores();
      syncPlayer();
      syncCards();
    } catch (e) {
      // never break editing
    }
  }
  function watchContent() {
    new MutationObserver(scheduleAfterRender).observe(view.contentDOM, {
      childList: true,
      subtree: true,
    });
  }

  // ---- The caret, drawn to the ink of the row it stands in ----
  //
  // drawSelection draws the caret at the height of the text's own box, and in
  // a face with a tall body that is a good deal more than the letters: Latin
  // Modern's box is 1.127 of ascent and 0.29 of descent against 0.9em of ink,
  // and the sheet draws the face at 1.225 of its size, so a 16px line of
  // prose stood in a 28px box with the caret 12px over the letters and 1.9px
  // under their descenders. The owner's report was that the caret sat too
  // low, and the low part was the foot: the box's foot is below the ink on
  // both faces (0.084em in the roman, 0.004 in the sans), and a cut that
  // keeps the foot where the box ends keeps the caret there too.
  //
  // So the caret is the face's own ink box, accents included: from the top of
  // an accented capital (the probe is the plain ascenders bdfhklt with ÁÉ
  // after them) down to the descenders (gjpqy). That is variant C of
  // design-caret.html and the owner's pick of the eight drawn there, over
  // variant G, which was the same box without the accents and left an Á
  // standing over the caret. What it comes to, measured in the harness:
  // 23.1px on a 16px row of the roman's prose against the 28 CodeMirror
  // draws, 43.2 against 54 on a `#`, 31.8 against 40 on a `##`, 18 against 19
  // on a line of code, and in the sans 18 against 17 on prose, 35 against 36
  // on a `#`. The foot lands on the deepest ink and the top on the accent,
  // both to within a fiftieth of a pixel, so nothing of the row's face stands
  // outside the caret on either side.
  //
  // The sans is the one place this is not a cut: its box and its ink very
  // nearly coincide, so covering the accent asks for a pixel more than
  // CodeMirror drew (18 against 17 in prose here). The caret is therefore
  // written whatever the direction, and what keeps a fitted caret from being
  // fitted again is the record below rather than a refusal to grow one.
  //
  // The accents are measured on the row's own face, so a face with no Á in it
  // falls back to another for that glyph and the caret follows the fallback.
  // Both faces the editor ships with carry them, and the monospace is the
  // reader's own.
  //
  // The metrics are the row's own, read at the size the row is really drawn
  // at: font-size-adjust changes the used size and not the computed one, so a
  // canvas asked for the size the sheet names measures Latin Modern 22 per
  // cent small. What says how big the face came out is the box the browser
  // gave the row's text, which is the face's ascent and descent at that used
  // size; `k` below is that ratio, and it is kept per face because a row with
  // no text on it has no box to read it from.
  //
  // The row is looked for under the caret's own box rather than taken from
  // the selection, so several carets need no bookkeeping and one CodeMirror
  // has not drawn is not there to be found. Under the middle of the box and
  // not its foot: on a blank line the box is a text row's, 28px in the
  // roman, centred on a line of 16, so its foot stood 6px into the next line
  // and the caret was cut to that line's face. Under a list, with a `##`
  // after the blank, it came out 31.8px, a heading's caret, where 23.1 is the
  // prose's (seen 2026-09-19). The middle is inside the caret's own row on
  // every kind of row measured: blank, prose, a wrapped row, `#`, `##`, code.
  const CARET_ASCENDERS = "bdfhkltÁÉ";
  const CARET_DESCENDERS = "gjpqy";
  const caretFaces = Object.create(null);
  // What was last written on a caret, so that a caret already cut is not cut
  // again: the foot below is taken from the box the caret stands in, which
  // after a fit is the fitted box, and a second pass would measure its own
  // work. CodeMirror writes both properties fresh whenever it redraws a
  // caret, and nothing else here writes either of them, so a caret whose two
  // properties are still the ones left here is a caret nothing has redrawn.
  // The height guard used to do this job on the side, by refusing to grow a
  // caret; variant C grows the sans's prose caret by a pixel and needed it
  // said plainly instead.
  const caretFitted = new WeakMap();
  const caretPad = document.createElement("canvas").getContext("2d");
  // The box the browser gave the row's own text, which is where the baseline
  // and the used size of the face are read from.
  function rowTextBox(row) {
    const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const box = range.getBoundingClientRect();
      if (box.height) return box;
    }
    return null;
  }
  function caretFace(row, text) {
    const cs = getComputedStyle(row);
    const key = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    let face = caretFaces[key];
    if (!face) {
      caretPad.font = key;
      const up = caretPad.measureText(CARET_ASCENDERS);
      const down = caretPad.measureText(CARET_DESCENDERS);
      face = caretFaces[key] = {
        asc: up.actualBoundingBoxAscent,
        desc: down.actualBoundingBoxDescent,
        fAsc: up.fontBoundingBoxAscent,
        fDesc: up.fontBoundingBoxDescent,
        k: 0,
      };
    }
    if (!face.k && text && face.fAsc + face.fDesc > 0) {
      face.k = text.height / (face.fAsc + face.fDesc);
    }
    return face;
  }
  function fitCaret(caret) {
    const done = caretFitted.get(caret);
    if (done && done.height === caret.style.height && done.top === caret.style.top) return;
    const box = caret.getBoundingClientRect();
    if (!box.height) return;
    const under = document.elementFromPoint(box.left + 1, (box.top + box.bottom) / 2);
    const row = under && under.closest ? under.closest("#app .cm-line") : null;
    if (!row) return;
    const text = rowTextBox(row);
    const face = caretFace(row, text);
    if (!face.k) return;
    const want = Math.round((face.asc + face.desc) * face.k * 10) / 10;
    if (!want) return;
    const top = parseFloat(caret.style.top);
    if (!isFinite(top)) return;
    // The baseline the caret stands on, taken from the box the caret was
    // drawn in: that box is the box of the text of the caret's own row, which
    // the row's first letter is not. A paragraph is one line of the document
    // and as many rows as the column gives it, so a caret three rows down was
    // placed against the baseline of the first and jumped 28.4px up the
    // paragraph (caught by the hyphenation tests, which delete through a
    // divided word row by row).
    const foot = box.bottom - face.fDesc * face.k;
    caret.style.height = want + "px";
    caret.style.top = top + (foot + face.desc * face.k - want - box.top) + "px";
    caretFitted.set(caret, { height: caret.style.height, top: caret.style.top });
  }  // drawSelection writes the carets in the measure phase, which runs after an
  // update, so the fit hangs off that write rather than off the update: a
  // MutationObserver callback is delivered before the frame is painted, so no
  // caret is ever painted at the height it was given. The layer itself is
  // built on the first measure, hence the frame the setup below waits.
  let caretLayer = null;
  // The writes of a pass are writes to the layers being watched, so the
  // records they queue are dropped at the end of it and the callback they
  // still deliver arrives with nothing in it.
  const caretWatcher = new MutationObserver(function (records) {
    if (records.length) fitCarets();
  });
  function fitCarets() {
    const layer = view.dom.querySelector(".cm-cursorLayer");
    if (!layer) return;
    if (layer !== caretLayer) {
      caretLayer = layer;
      const what = {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      };
      caretWatcher.observe(layer, what);
      // The selection is drawn in a layer of its own, and a card that scrolls
      // moves its rectangles as it moves the carets.
      const sel = view.dom.querySelector(".cm-selectionLayer");
      if (sel) caretWatcher.observe(sel, what);
    }
    layer.querySelectorAll(".cm-cursor").forEach(fitCaret);
    placeCardMarks(true);
    caretWatcher.takeRecords();
  }
  function watchCarets() {
    requestAnimationFrame(fitCarets);
  }

  // ---- A card of source scrolls inside itself ----
  //
  // The card is the column wide and the end of a line too long for it is
  // reached by scrolling the card, which is the box the exported page has
  // (one <pre> with `overflow-x: auto`). There is nothing here to hang that
  // box on: a card is a run of editable lines and CodeMirror owns their DOM.
  // So every line of the card is a scroll box of its own (style.css,
  // .mdm-code-line) and the run of them is kept at one offset here, or the
  // text of a scrolled card shears line by line.
  //
  // The rest of this is the other half of the same cost. The caret and the
  // selection are drawn by drawSelection in layers that sit outside the
  // lines, in the scroller's own coordinates, so a card scrolled without a
  // redraw leaves them standing over the glyphs they were written against,
  // and a caret that has gone past the card's window is drawn out over the
  // page beside it (34 px of document scroll with the caret still out of
  // sight, measured in the harness). Both are answered where the layers are
  // written: what drawSelection put there is remembered together with the
  // offset the card stood at, and from then on a mark of that card is moved
  // by the difference and cut to the card's window.
  const CARD_ROWS = ".mdm-code-line, .mdm-math-line, .mdm-fm-line";
  const CARD_FIRST = /mdm-(?:code|math|fm)-first/;
  const CARD_LAST = /mdm-(?:code|math|fm)-last/;
  // What a caret keeps between itself and the edge of the card it is brought
  // back into: the card's own air, 0.9em of the monospace it is set in.
  const CARD_AIR = 12;
  function isCardRow(el) {
    return !!(el && el.matches && el.matches(CARD_ROWS));
  }
  // The run of lines one card is drawn on, from any one of them. The ends
  // carry classes of their own, so two cards with no blank line between them
  // are two runs and not one.
  function cardRows(row) {
    const rows = [row];
    if (!CARD_FIRST.test(row.className)) {
      for (let el = row.previousElementSibling; isCardRow(el); el = el.previousElementSibling) {
        rows.unshift(el);
        if (CARD_FIRST.test(el.className)) break;
      }
    }
    if (!CARD_LAST.test(row.className)) {
      for (let el = row.nextElementSibling; isCardRow(el); el = el.nextElementSibling) {
        rows.push(el);
        if (CARD_LAST.test(el.className)) break;
      }
    }
    return rows;
  }
  // Every line of a card at one offset. A line CodeMirror has just rendered
  // comes back at nothing while the rest of the card stands where the reader
  // left it, and the rest are always in step (the two writers below move them
  // together), so the card's offset is the furthest of them.
  function syncCards() {
    let rows = [];
    const flush = function () {
      if (rows.length > 1) {
        let left = 0;
        rows.forEach(function (r) {
          if (r.scrollLeft > left) left = r.scrollLeft;
        });
        rows.forEach(function (r) {
          if (r.scrollLeft !== left) r.scrollLeft = left;
        });
      }
      rows = [];
    };
    for (let el = view.contentDOM.firstElementChild; el; el = el.nextElementSibling) {
      if (!isCardRow(el)) {
        flush();
        continue;
      }
      if (rows.length && CARD_FIRST.test(el.className)) flush();
      rows.push(el);
      if (CARD_LAST.test(el.className)) flush();
    }
    flush();
  }
  // The row a drawn mark stands on, read from the geometry rather than from
  // the selection: several carets need no bookkeeping that way, and a mark
  // CodeMirror drew for a range that is no longer there is not looked for.
  function cardRowUnder(box) {
    const mid = (box.top + box.bottom) / 2;
    const rows = view.contentDOM.querySelectorAll(CARD_ROWS);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (mid >= r.top && mid <= r.bottom) return rows[i];
    }
    return null;
  }
  // A caret set past the card's window is brought into it by scrolling the
  // card, because CodeMirror cannot: it reveals a caret by scrolling the
  // boxes the text is in, and the caret is not in them.
  function revealCaret(caret) {
    const box = caret.getBoundingClientRect();
    if (!box.height) return;
    const row = cardRowUnder(box);
    if (!row) return;
    const win = row.getBoundingClientRect();
    let by = 0;
    if (box.left < win.left + CARD_AIR) by = box.left - (win.left + CARD_AIR);
    else if (box.right > win.right - CARD_AIR) by = box.right - (win.right - CARD_AIR);
    if (!by) return;
    row.scrollLeft += by;
    const left = row.scrollLeft;
    cardRows(row).forEach(function (r) {
      if (r.scrollLeft !== left) r.scrollLeft = left;
    });
  }
  function rememberCardMark(el) {
    const box = el.getBoundingClientRect();
    if (!box.height) return;
    const row = cardRowUnder(box);
    if (!row) return;
    el.mdmLeft = parseFloat(el.style.left);
    // A caret has no width of its own (drawSelection draws it as a border),
    // which is what tells the two kinds of mark apart here.
    el.mdmWidth = parseFloat(el.style.width);
    el.mdmAt = row.scrollLeft;
  }
  function placeCardMark(el) {
    const box = el.getBoundingClientRect();
    if (!box.height) return;
    const row = cardRowUnder(box);
    if (!row) return;
    const layer = el.parentElement.getBoundingClientRect();
    if (!isFinite(el.mdmAt)) rememberCardMark(el);
    if (!isFinite(el.mdmLeft)) return;
    const win = row.getBoundingClientRect();
    // A mark drawn over whole rows is cut and not moved: it says which rows
    // are in the selection and not where in them, and it is the width of the
    // window already, so moving it would leave a strip of the window bare.
    const whole = box.height > row.offsetHeight + 1;
    const left = layer.left + el.mdmLeft - (whole ? 0 : row.scrollLeft - el.mdmAt);
    const right = left + (isFinite(el.mdmWidth) ? el.mdmWidth : 0);
    const from = Math.max(left, win.left);
    const to = Math.min(right, win.right);
    if (to < from - 0.01 || (right > left && to <= from)) {
      // Out of the card's window: not drawn, and not left standing out there
      // either, since a mark past the column makes the whole document
      // scrollable sideways.
      el.style.opacity = "0";
      el.style.left = win.left - layer.left + "px";
      if (isFinite(el.mdmWidth)) el.style.width = "0px";
      return;
    }
    el.style.opacity = "";
    el.style.left = from - layer.left + "px";
    if (isFinite(el.mdmWidth)) el.style.width = Math.max(0, to - from) + "px";
  }
  function placeCardMarks(fresh) {
    const carets = view.dom.querySelectorAll(".cm-cursorLayer .cm-cursor");
    const rects = view.dom.querySelectorAll(".cm-selectionLayer .cm-selectionBackground");
    if (fresh) {
      // The offset a mark was written against is remembered before the card
      // is moved to show the caret, so that the move is part of the
      // difference, and nothing is placed until the card has stopped moving:
      // a caret placed first is a caret already inside the window, and there
      // would be nothing left for the card to reveal.
      carets.forEach(rememberCardMark);
      rects.forEach(rememberCardMark);
      carets.forEach(revealCaret);
    }
    carets.forEach(placeCardMark);
    rects.forEach(placeCardMark);
  }
  function watchCardScroll() {
    // Scroll does not bubble, so the run of boxes is heard on the way down.
    view.dom.addEventListener(
      "scroll",
      function (e) {
        if (!isCardRow(e.target)) return;
        const left = e.target.scrollLeft;
        cardRows(e.target).forEach(function (r) {
          if (r !== e.target && r.scrollLeft !== left) r.scrollLeft = left;
        });
        placeCardMarks(false);
        caretWatcher.takeRecords();
      },
      true
    );
  }

  // Outside the sheet there is no document. The strip of pane either side of
  // the text column belongs to CodeMirror's scroller, which answers a click out
  // there like any other: the caret lands on the line at that height, and
  // beside a score that opens its source. The mousedown is taken here instead,
  // on the way down and above the scroller, so nothing below hears it: no
  // caret, no focus, no selection drag. Only the mousedown, so a click out
  // there still closes an open drop-down of the toolbar, and only the left
  // button, and never over the scrollbar, which is the scroller's own
  // furniture: it sits past clientWidth, and a mousedown taken from it would
  // kill the drag of the handle.
  //
  // The strip is everything .cm-content does not cover, and the stylesheet
  // makes that box the text column itself, so this boundary and the one the
  // pointer changes at are the same one.
  //
  // Except CodeMirror's panels (the search, Ctrl+F), which are inside the
  // view and outside the text: taken for margin, a click on the search field
  // left the focus on the body, so what was typed went nowhere and Escape
  // could not close the panel.
  function deadMargin(e) {
    if (e.button !== 0 || !e.target || !e.target.closest || !view) return;
    if (e.target.closest(".cm-content, .cm-panels")) return;
    const box = view.scrollDOM.getBoundingClientRect();
    if (e.clientX - box.left >= view.scrollDOM.clientWidth) return;
    e.preventDefault();
    e.stopPropagation();
    // The default is prevented, so the browser moves no focus of its own: the
    // margin takes it away by hand. That is what puts the document in visual
    // mode, the same as a click on the bare part of the bar or on the menu
    // bar of the window, and it is the whole point of clicking out there.
    leaveDocument();
  }

  // Anywhere but the text, whatever is open for editing goes back to its
  // drawing: the dead margin, the outline and its grip, the toolbar and its
  // panels. Caught on the way down at the document, so it is done before the
  // click is answered by whatever it was actually for. Not the buttons that
  // work on the selection (bold, a link, a list), which have to find it
  // where it is: with a word selected in a table cell, the Bold button put
  // the caret out under the table first and wrote `****` there (G064).
  function dismissFromOutside(e) {
    if (e.button !== 0 || !e.target || !e.target.closest || !view) return;
    // The player is not "anywhere but the text": listening to a score while
    // its ABC is open beside it is one gesture, and a press on play, on the
    // progress or on the volume must not shut the source under the reader.
    // Named here because the bar left the text and stopped being covered by
    // the .cm-content test; this listener is in the capture phase, so the bar
    // cannot answer for itself either.
    // The search panel works on the selection the way those buttons do: a
    // press on its field or its arrows must not put away the block its
    // current match opened.
    if (e.target.closest(".cm-content, .mdm-audio, .mdm-btn--caret, .cm-panels")) return;
    dismissOpenBlock();
  }

  // ---------- The search panel (Ctrl+F) ----------
  //
  // A row under the toolbar, the way the player's row is (design-search.html,
  // variant C, chosen 2026-09-19): the text moves down rather than being
  // covered, the glyphs are the toolbar's brass buttons and an option that is
  // on sits on the toolbar's disc. CodeMirror's own panel was 10px grey
  // buttons, browser checkboxes and a close button 9px wide. Only the panel
  // is ours: the query, the matches drawn in the text and every command are
  // @codemirror/search's, so Ctrl+F, Ctrl+G, F3 and Escape keep working.
  //
  // The controls keep the names CodeMirror's panel gave them (search,
  // replace, next, prev, select, replace, replaceAll, close), which is what
  // the tests find them by.

  // Fill only, on the 16-unit grid of the toolbar's icons.
  const SEARCH_ICONS = {
    prev: '<svg viewBox="0 0 16 16"><path d="M8 1.9 13 6.9l-1.2 1.2-3-3V14H7.2V5.1l-3 3L3 6.9Z"/></svg>',
    next: '<svg viewBox="0 0 16 16"><path d="M8 14.1 3 9.1l1.2-1.2 3 3V2h1.6v8.9l3-3L13 9.1Z"/></svg>',
    // Every match: three lines selected at once.
    select:
      '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.6" width="13" height="2.2" rx=".6"/><rect x="1.5" y="6.9" width="13" height="2.2" rx=".6"/><rect x="1.5" y="11.2" width="13" height="2.2" rx=".6"/></svg>',
    replace: '<svg viewBox="0 0 16 16"><path d="M1.5 7.2h9.4L8.3 4.6l1.2-1.2L14.1 8l-4.6 4.6-1.2-1.2 2.6-2.6H1.5Z"/></svg>',
    replaceAll:
      '<svg viewBox="0 0 16 16"><path d="M1.5 4.3h9.4L8.8 2.2 9.9 1.1l3.6 3.6-3.6 3.6-1.1-1.1 2.1-2.1H1.5Z"/><rect x="1.5" y="9.6" width="12" height="1.6" rx=".6"/><rect x="1.5" y="12.8" width="12" height="1.6" rx=".6"/></svg>',
    close:
      '<svg viewBox="0 0 16 16"><path d="M3.4 2.3 8 6.9l4.6-4.6 1.1 1.1L9.1 8l4.6 4.6-1.1 1.1L8 9.1l-4.6 4.6-1.1-1.1L6.9 8 2.3 3.4Z"/></svg>',
  };
  // How many matches are counted before the count says "+": the count is
  // taken again on every keystroke, and a document is not searched past it.
  const SEARCH_COUNT_CAP = 1000;

  function searchPanel(view) {
    let query = CM.getSearchQuery(view.state);
    const dom = document.createElement("div");
    dom.className = "mdm-search";

    const input = function (name, label) {
      const el = document.createElement("input");
      el.type = "text";
      el.name = name;
      el.placeholder = label;
      el.setAttribute("aria-label", label);
      el.spellcheck = false;
      el.autocomplete = "off";
      el.className = "mdm-search__input";
      return el;
    };
    const box = function (el) {
      const wrap = document.createElement("span");
      wrap.className = "mdm-search__field";
      wrap.appendChild(el);
      return wrap;
    };
    const button = function (name, tip, html, run, cls) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.name = name;
      btn.className = "mdm-btn mdm-tip mdm-tip--s" + (cls ? " " + cls : "");
      btn.setAttribute("aria-label", tip);
      btn.innerHTML = html;
      // The focus stays in the field, so a press on an arrow and then a key
      // carry on the search that was being typed.
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
      });
      btn.addEventListener("click", function () {
        run();
      });
      return btn;
    };
    const group = function (children) {
      const g = document.createElement("span");
      g.className = "mdm-search__group";
      children.forEach(function (c) {
        g.appendChild(c);
      });
      return g;
    };

    const search = input("search", "Find");
    // What openSearchPanel focuses and selects.
    search.setAttribute("main-field", "true");
    const replace = input("replace", "Replace");

    // The options, as the field's own buttons: on is the disc and nothing else.
    const options = [
      { name: "case", key: "caseSensitive", tip: "Match case", text: "Aa" },
      { name: "word", key: "wholeWord", tip: "Match whole word", text: "ab" },
      { name: "re", key: "regexp", tip: "Use regular expression", text: ".*" },
    ].map(function (o) {
      o.btn = button(
        o.name,
        o.tip,
        o.text,
        function () {
          o.btn.classList.toggle("mdm-btn--on");
          commit();
        },
        "mdm-search__opt"
      );
      return o;
    });
    const findBox = box(search);
    findBox.classList.add("mdm-search__field--find");
    options.forEach(function (o) {
      findBox.appendChild(o.btn);
    });

    const count = document.createElement("span");
    count.className = "mdm-search__count";
    count.setAttribute("aria-live", "polite");

    const act = function (command) {
      return function () {
        command(view);
      };
    };
    const close = button("close", "Close (Escape)", SEARCH_ICONS.close, function () {
      CM.closeSearchPanel(view);
      view.focus();
    });
    close.classList.add("mdm-search__close");
    const sep = document.createElement("span");
    sep.className = "mdm-toolbar__sep";

    dom.appendChild(
      group([
        findBox,
        count,
        button("prev", "Previous match (Shift+Enter)", SEARCH_ICONS.prev, act(CM.findPrevious)),
        button("next", "Next match (Enter)", SEARCH_ICONS.next, act(CM.findNext)),
        button("select", "Select all matches", SEARCH_ICONS.select, act(CM.selectMatches)),
      ])
    );
    dom.appendChild(
      group([
        sep,
        box(replace),
        button("replace", "Replace", SEARCH_ICONS.replace, act(CM.replaceNext)),
        button("replaceAll", "Replace all", SEARCH_ICONS.replaceAll, act(CM.replaceAll)),
      ])
    );
    dom.appendChild(close);

    // The fields and the options from a query, and a query from them.
    const show = function (q) {
      search.value = q.search;
      replace.value = q.replace;
      options.forEach(function (o) {
        o.btn.classList.toggle("mdm-btn--on", !!q[o.key]);
        o.btn.setAttribute("aria-pressed", q[o.key] ? "true" : "false");
      });
    };
    const commit = function () {
      const spec = { search: search.value, replace: replace.value };
      options.forEach(function (o) {
        spec[o.key] = o.btn.classList.contains("mdm-btn--on");
        o.btn.setAttribute("aria-pressed", spec[o.key] ? "true" : "false");
      });
      const q = new CM.SearchQuery(spec);
      if (q.eq(query)) return;
      query = q;
      view.dispatch({ effects: CM.setSearchQuery.of(q) });
    };
    // "3 of 12" with the selection on the third match, "? of 12" off every
    // match, as VS Code counts.
    const recount = function (state) {
      let text = "";
      if (query.search && !query.valid) text = "Invalid";
      else if (query.search) {
        const main = state.selection.main;
        let n = 0;
        let at = 0;
        const cursor = query.getCursor(state);
        for (let m = cursor.next(); !m.done; m = cursor.next()) {
          n++;
          if (m.value.from === main.from && m.value.to === main.to) at = n;
          if (n >= SEARCH_COUNT_CAP) break;
        }
        const total = n >= SEARCH_COUNT_CAP ? n + "+" : String(n);
        text = n === 0 ? "No results" : (at || "?") + " of " + total;
      }
      count.textContent = text;
      dom.classList.toggle("mdm-search--none", text === "No results" || text === "Invalid");
    };

    search.addEventListener("input", commit);
    replace.addEventListener("input", commit);
    dom.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey && (e.target === search || e.target === replace)) {
        e.preventDefault();
        if (e.target === replace) CM.replaceNext(view);
        else if (e.shiftKey) CM.findPrevious(view);
        else CM.findNext(view);
      } else if (e.key === "Escape") {
        e.preventDefault();
        CM.closeSearchPanel(view);
        view.focus();
      } else if (CM.runScopeHandlers(view, e, "search-panel")) {
        // Ctrl+F selects the field again, Ctrl+G and F3 walk the matches.
        e.preventDefault();
      }
    });

    show(query);
    return {
      dom: dom,
      top: true,
      // The field takes the keyboard as the panel opens, with what it holds
      // selected, which is what CodeMirror's own panel does on mount: the
      // first opening goes through here and not through openSearchPanel's
      // focus, which only reaches a panel already open.
      mount: function () {
        search.select();
        recount(view.state);
      },
      update: function (u) {
        // A query set from outside the panel (Ctrl+F over a selection) is
        // shown in it; one set by the panel is already there.
        let asked = false;
        u.transactions.forEach(function (tr) {
          tr.effects.forEach(function (e) {
            if (!e.is(CM.setSearchQuery)) return;
            asked = true;
            if (!e.value.eq(query)) {
              query = e.value;
              show(query);
            }
          });
        });
        if (asked || u.docChanged || u.selectionSet) recount(u.state);
      },
    };
  }

  // What shows its source while a caret is in it: a fenced block, code or
  // score, and an equation of either kind. Not the YAML header, and not
  // indented code: those are drawn the same way wherever the carets are, so
  // there is nothing to put away (see the decoration field below).
  const OPEN_NODES = /^(FencedCode|BlockMath|InlineMath|InlineBlockMath|Table)$/;

  // Both sides of the position are asked, since a caret at either edge of a
  // node counts as being in it (touchedBy), and resolveInner only looks the
  // way it is told to.
  function openNodeAt(state, pos) {
    const sides = [-1, 1];
    for (let i = 0; i < sides.length; i++) {
      let node = CM.syntaxTree(state).resolveInner(pos, sides[i]);
      while (node && !OPEN_NODES.test(node.name)) node = node.parent;
      if (node) return node;
    }
    return null;
  }

  // Where the caret goes when something open is put away: the line after the
  // one the node ends on, which is where a click in the text below it would
  // have left the caret. A node that ends the document is left by the line
  // above instead, and a document that is nothing but the node has nowhere to
  // go, so it stays as it is.
  function positionOutside(state, node) {
    const doc = state.doc;
    const last = doc.lineAt(node.to);
    if (last.number < doc.lines) return doc.line(last.number + 1).from;
    const first = doc.lineAt(node.from);
    if (first.number > 1) return doc.line(first.number - 1).to;
    return null;
  }

  // The one thing a click in the dead margin does: put away whatever is open
  // for editing. A caret carries the source of the block it is in, so the
  // click takes the caret out of it and the block goes back to its drawing.
  // Every caret is asked, not only the main one, and they collapse into the
  // one this leaves, so several blocks opened at once close together. With
  // nothing open the margin does nothing at all.
  // Caret by caret: the ones inside an open block come out of it, which is
  // what closes it, and every other one stays where it is. It used to replace
  // the whole selection with the single caret that came out, which threw away
  // the rest of a multicursor (measured: three carets, one of them in a code
  // block, came back as one after a click in the dead margin, and the two in
  // the prose were gone).
  function dismissOpenBlock() {
    const state = view.state;
    const sel = state.selection;
    let moved = false;
    const ranges = sel.ranges.map(function (range) {
      const node =
        openNodeAt(state, range.from) ||
        (range.to !== range.from ? openNodeAt(state, range.to) : null);
      if (!node) return range;
      const at = positionOutside(state, node);
      if (at === null) return range;
      moved = true;
      return CM.EditorSelection.cursor(at);
    });
    if (!moved) return;
    // No focus of its own: the click was prevented, so whatever had the focus
    // keeps it, and what the source hangs on is the selection, not the focus.
    view.dispatch({
      selection: CM.EditorSelection.create(ranges, sel.mainIndex),
    });
  }

  // The copy button and the player toggle live in widget chrome, which
  // CodeMirror leaves alone (ignoreEvent); their clicks are answered here.
  function handleChromeClick(e) {
    if (!e.target.closest) return;
    const row = e.target.closest(".mdm-audio-export .mdm-menu__item");
    if (row) {
      e.preventDefault();
      e.stopPropagation();
      closeMenus();
      const block = row.closest(".mdm-score");
      const number = block ? scoreNumber(block) : 0;
      // Never zero into exportAudio: no number there means the whole
      // document, and a rail button asks for its own score or for nothing.
      exportAudio(row.getAttribute("data-mdm-format"), number || -1);
      return;
    }
    const copy = e.target.closest(".mdm-copy");
    if (copy) {
      e.preventDefault();
      e.stopPropagation();
      // A press on the rail stops here, so a menu open anywhere (this rail's
      // or the toolbar's) is left standing unless it is closed by hand.
      closeMenus();
      copyBlock(copy);
      return;
    }
    const toggle = e.target.closest(".mdm-audio-toggle");
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const block = toggle.closest(".mdm-score");
      if (!block) return;
      closeMenus();
      if (player && playerBlock() === block) closePlayer();
      else {
        openPlayer(block);
        // Space plays from the moment the bar is open (watchPlayerKeys).
        // Only from this click: syncPlayer opens the player again whenever
        // its source is edited, and pulling the focus out of the text
        // mid-keystroke would stop the typing dead.
        if (player && player.bar) player.bar.focus({ preventScroll: true });
      }
      return;
    }
    const exporter = e.target.closest(".mdm-audio-export");
    if (exporter) {
      e.preventDefault();
      e.stopPropagation();
      const open = exporter.classList.contains("mdm-toolbar__item--open");
      closeMenus();
      if (!open) exporter.classList.add("mdm-toolbar__item--open");
      return;
    }
    // The rail of a score between and around its buttons: still inside the
    // widget, and so a click on the drawing to the code below, which would
    // throw a caret that is editing the tune back to the head of its source.
    if (e.target.closest(".mdm-chrome")) {
      e.preventDefault();
      return;
    }
    const drawing = e.target.closest(".mdm-score, .mdm-math, .mdm-table, .mdm-figure");
    if (drawing) {
      e.preventDefault();
      // A table says where in its source the click was: the cell it landed
      // on, as an offset from the head of the table (TableWidget).
      const cell = e.target.closest("[data-mdm-at]");
      revealBlock(drawing, addsCaret(e), cell ? Number(cell.dataset.mdmAt) : null, e.clientY);
    }
  }

  // A click on a rendered equation or score puts the caret at the start of
  // its source, which shows it (the block is touched from then on). For a
  // score and a display equation the source opens above the drawing, which
  // stays as the live preview.
  //
  // With the multicursor modifier down the caret is ADDED, as it is anywhere
  // else in the document: this is a click like any other, and replacing the
  // selection here wiped every caret that was already out in the prose.
  // `held` is the height on the screen the click was at, which the caret's
  // line is put back to once the source has opened (see the measure below).
  function revealBlock(el, adds, into, held) {
    if (!view) return;
    const pos = view.posAtDOM(el);
    const tree = CM.syntaxTree(view.state);
    // A block widget sits at the end of its block; the node is the one that
    // ends there. An inline widget sits in its own range.
    const block =
      el.classList.contains("mdm-score") ||
      el.classList.contains("mdm-table") ||
      el.classList.contains("mdm-figure") ||
      el.classList.contains("mdm-math--block");
    let node = tree.resolveInner(block ? Math.max(0, pos - 1) : pos, block ? -1 : 1);
    // A figure stands for the paragraph its image is alone in: the caret
    // goes to the head of that paragraph, the `![` of the source.
    const figure = el.classList.contains("mdm-figure");
    while (node && !(figure ? node.name === "Paragraph" : OPEN_NODES.test(node.name))) node = node.parent;
    if (!node && block) {
      // The closing line of a maths block may end in a paragraph of its own
      // (`$$ {#eq-mass}`): the block is the sibling before it.
      let para = tree.resolveInner(Math.max(0, pos - 1), -1);
      while (para && para.name !== "Paragraph") para = para.parent;
      const before = para && para.prevSibling;
      if (before && OPEN_NODES.test(before.name)) node = before;
    }
    let at = pos;
    if (node) {
      const content = node.getChild("CodeText") || node.getChild("BlockMathContent") || node.getChild("InlineMathContent") || node.getChild("InlineBlockMathContent");
      at = content ? content.from : node.from;
      // The offset a cell carries is counted from the head of the block, so
      // it holds however far the block has travelled since it was drawn.
      if (into != null) at = Math.min(node.from + into, node.to);
    }
    const sel = view.state.selection;
    view.dispatch({
      selection: adds
        ? CM.EditorSelection.create(
            sel.ranges.concat([CM.EditorSelection.cursor(at)]),
            sel.ranges.length
          )
        : { anchor: at },
      scrollIntoView: true,
    });
    // The source that opens is line after line of text the drawing did not
    // take: the block grows by that much, everything under it moves down and
    // the document seems to have scrolled away by itself. The click is held
    // instead. Once the new lines are laid out, the scroller is moved by
    // however far the caret's line has travelled from the height the click
    // was at, which leaves the line that was clicked where the eye left it.
    if (held != null) {
      view.requestMeasure({
        read: function (v) {
          const coords = v.coordsAtPos(v.state.selection.main.head);
          // The middle of the line against the middle of what was clicked, so
          // that an inline equation, whose source takes the height its drawing
          // took, is not nudged by half a line for nothing. Off the drawn
          // viewport there are no coordinates: the scrollIntoView above is
          // what puts the caret on the screen, and there is nothing to hold.
          if (!coords) return 0;
          return Math.round((coords.top + coords.bottom) / 2 - held);
        },
        write: function (moved, v) {
          if (moved) v.scrollDOM.scrollTop += moved;
        },
      });
    }
    view.focus();
  }

  // The source of the block a piece of chrome belongs to: a score and a
  // display equation carry it on their widget; a code block's chrome sits at
  // the start of the top line of its card, and the text is read back from the
  // editor at that position.
  function chromeSource(el) {
    const score = el.closest(".mdm-score");
    if (score) return { source: score.getAttribute("data-mdm-source") || "", score: score };
    const math = el.closest(".mdm-math--block");
    if (math) return { source: math.getAttribute("data-mdm-source") || "", math: math };
    const chrome = el.closest(".mdm-chrome--code");
    if (!chrome || !view) return null;
    const pos = view.posAtDOM(chrome);
    const tree = CM.syntaxTree(view.state);
    let node = tree.resolveInner(pos, 1);
    while (node && node.name !== "FencedCode") node = node.parent;
    if (!node) return null;
    const body = fenceBody(node);
    // The DOM lines of the block, for the pulse.
    const lines = [];
    if (body) {
      const doc = view.state.doc;
      for (let n = doc.lineAt(body.from).number; n <= doc.lineAt(body.to).number; n++) {
        const dom = view.domAtPos(doc.line(n).from).node;
        const line = dom && (dom.nodeType === 1 ? dom : dom.parentElement);
        const el = line && line.closest ? line.closest(".cm-line") : null;
        if (el) lines.push(el);
      }
    }
    return { source: fenceSource(view.state.doc, node), lines: lines };
  }

  // ---- The rail under the pointer ----
  //
  // A rail of buttons is shown while the pointer is on its block
  // (.mdm-chrome--hover), as it is while the block's source is open
  // (.mdm-chrome--open, from the widgets): a score, a display equation or a
  // block of code, its source lines included while they show, or the rail
  // itself (style.css, `#app .mdm-chrome`). Where the rail of a short block
  // hangs past it beside the next one's, the rail under the pointer is also
  // drawn over the others, as the caret's is over the rest
  // (.mdm-chrome--active).
  //
  // Which rail is read off the element under the pointer. A score and an
  // equation are one element each with their rail inside; the source lines
  // of either run straight into that element; a block of code is lines, and
  // its chrome rides the top one of them.
  function chromeUnder(target) {
    if (!view || !target || !target.closest) return null;
    const rail = target.closest(".mdm-chrome");
    if (rail) return rail;
    const drawing = target.closest(".mdm-score, .mdm-math--block");
    if (drawing) return drawing.querySelector(":scope > .mdm-chrome");
    const line = target.closest(".cm-line");
    if (!line || !view.contentDOM.contains(line)) return null;
    if (line.classList.contains("mdm-abc-line")) return railAfter(line, "mdm-abc-line", "mdm-score");
    if (line.classList.contains("mdm-math-line")) return railAfter(line, "mdm-math-line", "mdm-math--block");
    if (!line.classList.contains("mdm-code-line")) return null;
    // Back up the lines of the block to the one the chrome rides. What stands
    // between two of them with no class is a hidden fence; anything else with
    // a class (a drawing, the cover of a block) is the end of the block.
    for (let el = line; el; el = el.previousElementSibling) {
      if (el.classList.contains("cm-line")) {
        if (!el.classList.contains("mdm-code-line") || el.classList.contains("mdm-abc-line")) return null;
        const chrome = el.querySelector(".mdm-chrome--code");
        if (chrome) return chrome;
      } else if (el.className) {
        return null;
      }
    }
    return null;
  }

  function railAfter(line, lineClass, drawingClass) {
    let el = line;
    while (el && el.classList.contains(lineClass)) el = el.nextElementSibling;
    return el && el.classList.contains(drawingClass) ? el.querySelector(":scope > .mdm-chrome") : null;
  }

  let hoveredRail = null;
  let pointerAt = null;
  function hoverRail(rail) {
    if (rail === hoveredRail) return;
    if (hoveredRail) hoveredRail.classList.remove("mdm-chrome--hover");
    hoveredRail = rail;
    if (rail) rail.classList.add("mdm-chrome--hover");
  }

  function handleRailPointer(e) {
    pointerAt = { x: e.clientX, y: e.clientY };
    hoverRail(chromeUnder(e.target));
  }

  function leaveRailPointer() {
    pointerAt = null;
    hoverRail(null);
  }

  // After CodeMirror redraws, the element under a pointer that has not moved
  // may be a new one (a block opened by the click that just landed, its chrome
  // moved from the first line of code to the fence), or a rail's element may
  // have been handed to another block: read the pointer's place again.
  let railRefresh = 0;
  function refreshRailPointer() {
    if (!pointerAt || railRefresh) return;
    railRefresh = requestAnimationFrame(function () {
      railRefresh = 0;
      if (!pointerAt) return;
      hoverRail(chromeUnder(document.elementFromPoint(pointerAt.x, pointerAt.y)));
    });
  }

  // ---- The rail of an open block stays where it stood ----
  //
  // A score and a display equation are block widgets under their source, and
  // the rail rides the widget: when a caret opened the source, the lines of
  // it came in above the drawing and the rail went down with the drawing, a
  // tune's height of source away from where the reader had just pressed its
  // copy. The rail of an open one is stood on the first line of its source
  // instead, which is where the top of the block was while it was shut, and
  // where a block of code keeps its own rail either way (on its fence). The
  // lift is read off the lines as they are laid out, since the source can be
  // any number of rows and grows as it is typed, and it is read after every
  // redraw of the view (CodeMirror's measure cycle, so before the frame is
  // painted and the rail is never seen in the old place).
  function placeOpenRails() {
    if (!view) return;
    view.requestMeasure({
      key: "mdm-open-rails",
      read: function () {
        const moves = [];
        const blocks = view.contentDOM.querySelectorAll(
          ":scope > .mdm-score, :scope > .mdm-math--block, " +
            ":scope > .mdm-block-framed > .mdm-score, :scope > .mdm-block-framed > .mdm-math--block"
        );
        blocks.forEach(function (block) {
          const rail = block.querySelector(":scope > .mdm-chrome");
          if (!rail) return;
          const lineClass = block.classList.contains("mdm-score") ? "mdm-abc-line" : "mdm-math-line";
          // The block's place among the lines is its wrapper's when it has
          // one (a block in a quote).
          const outer = block.parentElement.classList.contains("mdm-block-framed") ? block.parentElement : block;
          let first = null;
          for (let el = outer.previousElementSibling; el && el.classList.contains(lineClass); el = el.previousElementSibling) {
            first = el;
          }
          const lift = first
            ? (block.getBoundingClientRect().top - first.getBoundingClientRect().top) / (view.scaleY || 1)
            : 0;
          moves.push([rail, lift]);
        });
        return moves;
      },
      write: function (moves) {
        moves.forEach(function (move) {
          const top = move[1] > 0.5 ? -move[1] + "px" : "";
          if (move[0].style.top !== top) move[0].style.top = top;
        });
      },
    });
  }

  const COPIED_MS = 1500;

  function copyBlock(button) {
    const found = chromeSource(button);
    if (!found) return;
    copyPlain(found.score ? stripLayoutDirectives(found.source) : found.source);
    // The answer is the tooltip itself, so it stays up for a beat and then
    // goes, rather than sitting there under a pointer that has not moved
    // until the pointer leaves the button. A second and a half is long enough to
    // be read without becoming a label of its own; it is what the copy
    // buttons of GitHub and the like hold theirs for.
    button.setAttribute("aria-label", "Copied");
    setTimeout(function () {
      hideTipUntilLeave(button);
      button.setAttribute("aria-label", "Copy");
    }, COPIED_MS);
    if (found.score) {
      pulseBlock(found.score);
    } else if (found.math) {
      pulseBlock(found.math);
    } else if (found.lines) {
      found.lines.forEach(pulseBlock);
    }
  }

  // ---------- The editor ----------

  // Reading the modifier setting once at build time would pin it: the click
  // facet is a Compartment so a change from the host reconfigures it live.
  const gestures = new CM.Compartment();

  // The Markdown language, in a Compartment of its own so the parse can be
  // started over: a `[label]: url` definition decides whether `[label]`
  // anywhere in the document is a link (links.js in vendor-src), and the
  // fragments of the tree that an edit leaves untouched are not parsed
  // again, so a definition typed under a paragraph left the `[label]`
  // above it as text. Reconfiguring the compartment with a fresh language
  // makes CodeMirror parse the document from the start (a new Language
  // value replaces the parse state), which is asked for when, and only
  // when, the set of definitions changes (definitionsChanged).
  const language = new CM.Compartment();
  function markdownLanguage() {
    return CM.markdown({
      base: CM.markdownLanguage,
      codeLanguages: CM.codeLanguages,
      extensions: CM.mdmMarkdownExtensions,
      // Its keymap would go in at high precedence, over mdmKeymap.
      addKeymap: false,
    });
  }
  // The labels defined in the document, sorted and joined, as of the last
  // look; the definitions are read the way the parser reads them.
  let definitionKeys = null;
  function definitionKeysOf(doc) {
    return Array.from(CM.scanDefinitions(doc.toString())).sort().join("\n");
  }
  // True when a change altered the set of definitions. The whole document
  // is read only when a changed line holds `]:` before or after the
  // change, which every definition does; a keystroke in prose reads a
  // line or two.
  function definitionsChanged(update) {
    let touched = false;
    update.changes.iterChangedRanges(function (fromA, toA, fromB, toB) {
      if (touched) return;
      const before = update.startState.doc;
      const after = update.state.doc;
      touched =
        before.sliceString(before.lineAt(fromA).from, before.lineAt(toA).to).indexOf("]:") >= 0 ||
        after.sliceString(after.lineAt(fromB).from, after.lineAt(toB).to).indexOf("]:") >= 0;
    });
    if (!touched) return false;
    const keys = definitionKeysOf(update.state.doc);
    if (keys === definitionKeys) return false;
    definitionKeys = keys;
    return true;
  }
  function gestureExtensions() {
    return [
      EditorView.clickAddsSelectionRange.of(addsCaret),
      CM.rectangularSelection({
        eventFilter: function (e) {
          return e.altKey && e.shiftKey;
        },
      }),
    ];
  }

  // ---- Home and End inside a card of source ----
  //
  // A card scrolls inside itself, and CodeMirror finds the start of a visual
  // line by asking the browser which character sits at the editor's own left
  // edge, because the editor wraps (moveToLineBoundary takes that road
  // whenever view.lineWrapping is on). Over a card that is scrolled the
  // browser answers with the character at the edge of the card's window: at a
  // 166px offset Home landed 20 characters into the line and Shift-Home
  // selected from there (measured in the harness). A line of source does not
  // wrap, so the ends of the line are the answer, which is what CodeMirror
  // itself does when nothing in the editor wraps at all.
  const CARD_NODES = /^(?:FencedCode|CodeBlock|BlockMath|FrontMatter)$/;
  function inCard(state, pos) {
    let node = CM.syntaxTree(state).resolveInner(pos, 1);
    while (node) {
      if (CARD_NODES.test(node.name)) return true;
      node = node.parent;
    }
    return false;
  }
  function cardLineBoundary(forward, extend) {
    return function (view) {
      const state = view.state;
      let moved = false;
      const ranges = state.selection.ranges.map(function (r) {
        const line = state.doc.lineAt(r.head);
        // Anywhere else this is CodeMirror's to answer, wrapped rows and all.
        if (!inCard(state, line.from)) return r;
        moved = true;
        const to = forward ? line.to : line.from;
        return extend
          ? CM.EditorSelection.range(r.anchor, to)
          : CM.EditorSelection.cursor(to, forward ? -1 : 1);
      });
      if (!moved) return false;
      view.dispatch({
        selection: CM.EditorSelection.create(ranges, state.selection.mainIndex),
        scrollIntoView: true,
        userEvent: "select",
      });
      return true;
    };
  }

  function buildEditor(text) {
    const mdmKeymap = [
      // Ctrl+S goes on to the workbench, which saves the file: what is held
      // back by the debounce is sent ahead of it, and the host holds the save
      // for it besides (onWillSaveTextDocument in extension.js). Not handled,
      // so the key is not eaten here.
      {
        key: "Mod-s",
        run: function () {
          flushEdit();
          return false;
        },
      },
      { key: "Enter", run: mdmEnter },
      { key: "Backspace", run: mdmBackspace },
      { key: "Delete", run: mdmDelete },
      { key: "Tab", run: mdmTab, shift: mdmShiftTab },
      { key: "Mod-Enter", run: leaveBlock },
      // The formatting keys stop where they are answered. VS Code's webview
      // host listens for keydown on the page's window, in the bubble phase
      // and whether or not the page prevented the default, and hands every
      // key to the workbench as well (did-keydown, read in the host page of
      // VS Code 1.133.0): Ctrl+B set bold and hid the Explorer at once, and
      // Ctrl+K left the workbench waiting for the second key of a chord.
      // Stopped, the key is the text's while the caret is in it; with the
      // focus anywhere else CodeMirror does not hear it and it goes on to
      // VS Code as before. Not Ctrl+S nor Ctrl+Z: VS Code saves and undoes
      // the file on its side from that same message.
      { key: "Mod-b", run: toggleInline("**"), stopPropagation: true },
      { key: "Mod-i", run: toggleInline("*"), stopPropagation: true },
      { key: "Mod-e", run: toggleInline("`"), stopPropagation: true },
      { key: "Mod-k", run: insertLink, stopPropagation: true },
      // The block keys, all on one second modifier (BLOCK_MOD, Shift on a
      // PC and Option on a Mac): a digit for a line that has a level, the
      // digit being the level, with 0 for the paragraph, and a letter for
      // the blocks that have none. The code block was Notion's Ctrl+Shift+8
      // for a day and is C now (2026-09-19, the owner's call, for the
      // symmetry): with it there is no exception left to the rule, every
      // digit is a level and every block without one is a letter. Notion's
      // row is where the 0 comes from; it spends 4 to 7 on its blocks
      // because its headings stop at 3, and the six levels of a .mdm want
      // the whole row.
      // The letters: C for the code block and not E, the letter of its
      // inline twin, since Ctrl+Shift+E is Show Explorer and is wanted far
      // more often than the external terminal C takes. (Typora's
      // Ctrl+Shift+K for a code block is Delete Line here, as it is in VS
      // Code's own editor.)
      // The bullets, the numbers and the quote had U, O and Q for a day and
      // have no key now (2026-09-19, the owner's call): `- `, `1. ` and
      // `> ` are so little to type at the head of a line that the chord
      // bought nothing, and one of the three cost: on Linux the desktop
      // takes Ctrl+Shift+U before any editor sees it, fcitx5's unicode
      // addon opening its `U+` prompt on it (the default of
      // libunicode.so's "Type unicode in Hex number"). VS Code leaves that
      // chord alone on Linux as well: Toggle Output is Ctrl+Shift+U on the
      // other platforms and the chord Ctrl+K Ctrl+H there (1.133.0,
      // primary 3123 with a linux override).
      // Their buttons name no key now, and the three chords go to VS Code
      // from the text like any key the page does not bind.
      // What the set takes from the workbench, read in VS Code 1.133.0 and
      // only while the caret is in the text (the stopPropagation): of
      // Ctrl+Shift+0 to 9 it binds 1 (replace, inside the search view) and 5
      // (split, with the terminal focused), neither of which a .mdm can be
      // in; of the letters, T is Reopen Closed Editor and C opens an
      // external terminal.
      { key: "Mod-Shift-0", mac: "Mod-Alt-0", run: applyHeading(0), stopPropagation: true },
      { key: "Mod-Shift-1", mac: "Mod-Alt-1", run: applyHeading(1), stopPropagation: true },
      { key: "Mod-Shift-2", mac: "Mod-Alt-2", run: applyHeading(2), stopPropagation: true },
      { key: "Mod-Shift-3", mac: "Mod-Alt-3", run: applyHeading(3), stopPropagation: true },
      { key: "Mod-Shift-4", mac: "Mod-Alt-4", run: applyHeading(4), stopPropagation: true },
      { key: "Mod-Shift-5", mac: "Mod-Alt-5", run: applyHeading(5), stopPropagation: true },
      { key: "Mod-Shift-6", mac: "Mod-Alt-6", run: applyHeading(6), stopPropagation: true },
      { key: "Mod-Shift-c", mac: "Mod-Alt-c", run: toggleCodeBlock, stopPropagation: true },
      { key: "Mod-Shift-t", mac: "Mod-Alt-t", run: toggleTask, stopPropagation: true },
      { key: "ArrowDown", run: stepIntoBlock(1), shift: stepIntoBlock(1, true) },
      { key: "ArrowUp", run: stepIntoBlock(-1), shift: stepIntoBlock(-1, true) },
      { key: "Ctrl-Alt-ArrowDown", mac: "Cmd-Alt-ArrowDown", run: addCaretVertically(1) },
      { key: "Ctrl-Alt-ArrowUp", mac: "Cmd-Alt-ArrowUp", run: addCaretVertically(-1) },
      // Before searchKeymap's own Mod-d, so the substring toggle is honoured.
      { key: "Mod-d", run: selectNextOccurrenceMaybe },
      // Before defaultKeymap's own, and only over a card: everywhere else
      // these return false and CodeMirror answers them.
      {
        key: "Home",
        run: cardLineBoundary(false, false),
        shift: cardLineBoundary(false, true),
      },
      { key: "End", run: cardLineBoundary(true, false), shift: cardLineBoundary(true, true) },
      {
        mac: "Cmd-ArrowLeft",
        run: cardLineBoundary(false, false),
        shift: cardLineBoundary(false, true),
      },
      {
        mac: "Cmd-ArrowRight",
        run: cardLineBoundary(true, false),
        shift: cardLineBoundary(true, true),
      },
    ];
    const state = CM.EditorState.create({
      doc: text,
      extensions: [
        CM.EditorState.allowMultipleSelections.of(true),
        CM.drawSelection(),
        CM.dropCursor(),
        CM.history(),
        gestures.of(gestureExtensions()),
        CM.highlightSelectionMatches(),
        // A paste that carries no text (a picture, or rich text alone) is
        // not a paste of nothing: CodeMirror's own handler replaced the
        // selection with the empty string it was given, and the emptied text
        // went to the host (G082). Taken here, the selection stays as it was.
        CM.EditorView.domEventHandlers({
          paste: function (e) {
            const data = e.clipboardData;
            if (!data) return false;
            return !data.getData("text/plain") && !data.getData("text/uri-list");
          },
        }),
        CM.search({ top: true, createPanel: searchPanel }),
        CM.keymap.of(
          mdmKeymap.concat(
            // lang-markdown's own keymap is not installed by the language
            // (addKeymap below): Enter, Backspace, Delete and Tab are the
            // editor's own (mdmEnter, mdmBackspace, mdmDelete, mdmTab).
            CM.defaultKeymap,
            CM.historyKeymap,
            CM.searchKeymap
          )
        ),
        language.of(markdownLanguage()),
        CM.syntaxHighlighting(mdmHighlight),
        // Before renderField, which reads it: a field only sees the fields
        // configured ahead of it already updated.
        focusField,
        hiddenLinesField,
        renderField,
        hyphenationField,
        EditorView.lineWrapping,
        EditorView.updateListener.of(function (update) {
          if (update.docChanged) {
            if (!applying) {
              noteLocalChange(update.changes);
              queueEdit();
            }
            // A definition added, removed or renamed: the links it decides
            // may be anywhere in the document, so the parse starts over
            // (see `language`). Listeners run once the update is applied,
            // so this dispatch is a transaction of its own, one that
            // changes no text and comes back through here without it.
            if (definitionsChanged(update)) view.dispatch({ effects: language.reconfigure(markdownLanguage()) });
            if (player) player.pos = update.changes.mapPos(player.pos, 1);
            // A `lang:` typed into the header on screen lights or darkens
            // the hyphenation button at once, as it moves the cuts.
            updateHyphenationButton();
          }
          refreshRailPointer();
          placeOpenRails();
          if (update.docChanged || update.selectionSet) {
            updateUndoButtons();
            // The outline follows the document and the caret while it is
            // open; the parse it follows on its own (parseForOutline).
            if (outlineOpen) {
              if (update.docChanged) outlineAfterChange(update.changes);
              else markCurrentOutline();
            }
          }
        }),
      ],
    });
    definitionKeys = definitionKeysOf(state.doc);
    view = new EditorView({
      state: state,
      parent: document.querySelector("#app .mdm-editor"),
    });
    startSync(text);
    // applyHyphenation ran above with no view to read the header from.
    updateHyphenationButton();
    // For the test harness and for poking at a live editor: the view itself,
    // and the open player, which is the only way in to the synth controller
    // (abcjs keeps it on no element of the bar it builds).
    window.__mdm = {
      view: view,
      CM: CM,
      exportAudio: exportAudio,
      documentScores: function () {
        return view ? documentScores(view.state) : null;
      },
      // Where the decorations on screen part from a rebuild of the whole
      // document, or null: what a test of the partial rebuild reads.
      rebuilds: rebuilds,
      // The equations kept rendered, for the test of their bound.
      katex: { cache: KATEX_CACHE, held: katexHeld, render: renderTex },
      checkDecorations: function () {
        if (!view) return null;
        // With the definitions read again, so that a set kept from a tree
        // whose definitions have moved on shows.
        definitionsByTree.delete(CM.syntaxTree(view.state));
        return decorationsDiffer(view.state.field(renderField), buildDecorations(view.state));
      },
      get player() {
        return player;
      },
    };
    watchContent();
    watchCarets();
    watchCardScroll();
    disarmNativeHistory();
    // Not CodeMirror's own focusChangeEffect: it reports the focus of the
    // text alone and it reports it a tick late (its handler defers), so the
    // player bar read as leaving the document and the first click into an
    // unfocused editor drew one frame with nothing open. Both are answered by
    // watching the focus over the whole view, synchronously.
    document.addEventListener(
      "mousedown",
      function (e) {
        pressedAt = Date.now();
        // A left button going down over the editor holds the drawing (see
        // pointerHeld); the buttons of a block's rail and the toolbar move
        // no caret by being pressed and do not.
        if (e.button === 0 && view && view.dom.contains(e.target)) pointerHeld = true;
      },
      true
    );
    // The release comes wherever the pointer is by then, so it is read off
    // the window; a window that loses the button (Alt+Tab mid-press) is read
    // as a release too, so the drawing is never held for good.
    const releasePointer = function () {
      if (!pointerHeld) return;
      pointerHeld = false;
      if (heldRebuild && view) view.dispatch({ effects: pointerReleased.of(true) });
    };
    window.addEventListener("mouseup", releasePointer, true);
    window.addEventListener("blur", releasePointer);
    view.dom.addEventListener("focusin", syncFocus);
    view.dom.addEventListener("focusout", function () {
      // On the way out the focus has not landed yet: activeElement is still
      // the element being left. Ask once it has.
      setTimeout(syncFocus, 0);
    });
    view.contentDOM.addEventListener("mousedown", handleMouseDown, true);
    view.contentDOM.addEventListener("click", handleChromeClick, true);
    // On the scroller and not the text, so that the pointer going out into the
    // margin lets a rail down as well as the pointer going onto another block.
    view.scrollDOM.addEventListener("mousemove", handleRailPointer);
    view.scrollDOM.addEventListener("mouseleave", leaveRailPointer);
    // Above the scroller, so the margins are dead before CodeMirror hears them.
    view.dom.addEventListener("mousedown", deadMargin, true);
    document.addEventListener("mousedown", dismissFromOutside, true);
    document.addEventListener("click", dismissTip, true);
  }

  // The element that scrolls.
  function scroller() {
    return view ? view.scrollDOM : null;
  }

  // ---------- Toolbar ----------

  // The bar is ours: a row of buttons, some with a drop-down panel. Each
  // button carries a data-type (what the stylesheet, the tests and the update
  // functions above look it up by), an aria-label the CSS tooltip is drawn
  // from, and a fill-only SVG.

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
  // tangential head. Same 16-unit grid and fill-only rules as every other
  // icon here; redo mirrors undo.
  const UNDO_ICON =
    '<svg viewBox="0 0 16 16"><path d="M3.32 12.22A6.3 6.3 0 1 0 3.32 3.78L4.99 5.29A4.05 4.05 0 1 1 4.99 10.71Z"/><path d="M6.14 6.33L2.17 2.75L1.28 7.73Z"/></svg>';
  const REDO_ICON =
    '<svg viewBox="0 0 16 16"><path d="M12.68 12.22A6.3 6.3 0 1 1 12.68 3.78L11.01 5.29A4.05 4.05 0 1 0 11.01 10.71Z"/><path d="M9.86 6.33L13.83 2.75L14.72 7.73Z"/></svg>';

  // Formatting glyphs, fill only: a bold B, a slanted I, a code chevron pair,
  // a chain link, two H of different sizes, and the three list glyphs, which
  // are one drawing with three markers (see LIST_ICON).
  const BOLD_ICON =
    '<svg viewBox="0 0 16 16"><path d="M4 2h4.6q1.7 0 2.6.8t.9 2.1q0 .9-.5 1.6t-1.3.9v.1q1.1.2 1.7 1t.6 1.9q0 1.6-1.1 2.6T8.6 14H4Zm2.3 4.9h2q.8 0 1.2-.4t.4-1-.4-1-1.2-.4h-2Zm0 5.1h2.3q.9 0 1.4-.4t.5-1.1-.5-1.1-1.4-.4H6.3Z"/></svg>';
  const ITALIC_ICON =
    '<svg viewBox="0 0 16 16"><path d="M6.5 2h5.5l-.4 1.9H9.8L7.6 12.1h1.8L9 14H3.5l.4-1.9h1.8L7.9 3.9H6.1Z"/></svg>';
  const CODE_ICON =
    '<svg viewBox="0 0 16 16"><path d="M5.2 3.6 6.4 4.8 3.3 8l3.1 3.2-1.2 1.2L.9 8Zm5.6 0L15.1 8l-4.3 4.4-1.2-1.2L12.7 8 9.6 4.8Z"/></svg>';
  // The code block: the chevrons of inline code, a little smaller, between
  // a rule above and a rule below for the two fence lines of the block
  // (design-code-block.html, variant B, the owner's pick). The rules are
  // the list glyphs' bars at full width.
  const CODE_BLOCK_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="1.2" width="14" height="1.4" rx=".7"/><path d="M1.2 8 4.8 4.4 5.93 5.53 3.46 8 5.93 10.47 4.8 11.6ZM14.8 8 11.2 4.4 10.07 5.53 12.54 8 10.07 10.47 11.2 11.6Z"/><rect x="1" y="13.4" width="14" height="1.4" rx=".7"/></svg>';
  const LINK_ICON =
    '<svg viewBox="0 0 16 16"><path d="M6.6 9.4a3 3 0 0 1 0-4.2l2-2a3 3 0 0 1 4.2 4.2l-1 1-1.1-1.1 1-1a1.5 1.5 0 0 0-2.1-2.1l-2 2a1.5 1.5 0 0 0 0 2.1ZM9.4 6.6a3 3 0 0 1 0 4.2l-2 2a3 3 0 0 1-4.2-4.2l1-1 1.1 1.1-1 1a1.5 1.5 0 0 0 2.1 2.1l2-2a1.5 1.5 0 0 0 0-2.1Z"/></svg>';
  // Two H standing on the same line, one the height of the other's cap: the
  // H every editor draws for a heading, and a second size to say the button
  // opens the six levels rather than making a first-level heading, which is
  // what the 1 it carried used to say (design-heading-icon.html, A, the
  // owner's pick).
  const HEADING_ICON =
    '<svg viewBox="0 0 16 16"><path d="M1 2.5h2v4.5h3.5V2.5h2v11h-2V9H3v4.5H1Z"/><path d="M10 7h1.4v2.55h2.2V7H15v6.5h-1.4v-2.55h-2.2V13.5H10Z"/></svg>';
  // The three list glyphs are one drawing: two rows of the same bar with a
  // different marker in front of each. The task glyph had them and the other
  // two had three thinner rows, so at 15px the three buttons did not read as
  // a family (the owner asked for the task's construction, 2026-09-19).
  // The grid is the task glyph's, unchanged: the bars are its own paths,
  // 7.5 to 14.5 and 1.4 thick, on rows at 4 and 12, and the marker column is
  // the 0.7 to 6.5 its check and box stand in.
  //
  // The markers carry the same weight as those bars. The bullet is a disc of
  // r 1.9, the mass of the box beside it; the figures are DejaVu Sans Bold at
  // 5.8 units, where the stem of the 1 measures 364/1493 of the glyph's own
  // height, which is 1.41 units, the bars' 1.4 (measured in the outline, not
  // guessed). They hang to the right, as the numbers of a list do in the
  // margin the editor draws them in.
  const LIST_ICON =
    '<svg viewBox="0 0 16 16"><circle cx="3.4" cy="4" r="1.9"/><circle cx="3.4" cy="12" r="1.9"/><path d="M8.2 3.3H13.8A.7 .7 0 0 1 14.5 4V4A.7 .7 0 0 1 13.8 4.7H8.2A.7 .7 0 0 1 7.5 4V4A.7 .7 0 0 1 8.2 3.3Z"/><path d="M8.2 11.3H13.8A.7 .7 0 0 1 14.5 12V12A.7 .7 0 0 1 13.8 12.7H8.2A.7 .7 0 0 1 7.5 12V12A.7 .7 0 0 1 8.2 11.3Z"/></svg>';
  const OLIST_ICON =
    '<svg viewBox="0 0 16 16"><path d="M2.04 5.87H3.37V2.12L2.01 2.4V1.38L3.36 1.1H4.78V5.87H6.1V6.9H2.04Z"/><path d="M3.59 13.82H6.1V14.9H1.96V13.82L4.04 11.98Q4.32 11.73 4.45 11.49Q4.59 11.25 4.59 10.99Q4.59 10.59 4.32 10.35Q4.05 10.1 3.6 10.1Q3.26 10.1 2.85 10.25Q2.44 10.4 1.98 10.69V9.44Q2.47 9.27 2.96 9.19Q3.44 9.1 3.91 9.1Q4.93 9.1 5.5 9.55Q6.06 10 6.06 10.81Q6.06 11.27 5.82 11.67Q5.58 12.08 4.81 12.75Z"/><path d="M8.2 3.3H13.8A.7 .7 0 0 1 14.5 4V4A.7 .7 0 0 1 13.8 4.7H8.2A.7 .7 0 0 1 7.5 4V4A.7 .7 0 0 1 8.2 3.3Z"/><path d="M8.2 11.3H13.8A.7 .7 0 0 1 14.5 12V12A.7 .7 0 0 1 13.8 12.7H8.2A.7 .7 0 0 1 7.5 12V12A.7 .7 0 0 1 8.2 11.3Z"/></svg>';
  // Strikethrough: the S of DejaVu Sans Bold, at the height of the bold B,
  // cut across the middle where the bar goes, so the bar reads at 15px
  // instead of melting into the curve (design-markdown-buttons.html, A).
  const STRIKE_ICON =
    '<svg viewBox="0 0 16 16"><path d="M11.68 2.75 11.68 5.12 11.37 4.99 11.07 4.87 10.77 4.76 10.47 4.66 10.17 4.57 9.88 4.5 9.59 4.43 9.31 4.38 9.03 4.34 8.75 4.31 8.49 4.3 8.22 4.29 7.9 4.3 7.6 4.32 7.33 4.36 7.09 4.42 6.88 4.49 6.7 4.57 6.55 4.68 6.42 4.8 6.33 4.94 6.26 5.09 6.22 5.27 6.2 5.46 6.21 5.6 6.24 5.74 6.29 5.86 6.35 5.97 6.43 6.07 6.54 6.16 6.66 6.24 6.82 6.32 7 6.39 7.22 6.46 7.47 6.53 7.75 6.59 7.8 6.6 3.71 6.6 3.68 6.5 3.61 6.1 3.59 5.67 3.62 5.13 3.71 4.64 3.86 4.19 4.07 3.78 4.34 3.42 4.67 3.1 5.05 2.82 5.49 2.6 5.98 2.42 6.52 2.3 7.12 2.22 7.77 2.2 8.08 2.2 8.39 2.22 8.7 2.23 9.02 2.26 9.34 2.3 9.66 2.34 9.99 2.39 10.32 2.45 10.65 2.51 10.99 2.58 11.33 2.67 11.68 2.75Z"/><path d="M12.34 9.4 12.39 9.69 12.41 10.15 12.38 10.74 12.29 11.27 12.14 11.76 11.92 12.19 11.65 12.57 11.31 12.9 10.92 13.17 10.45 13.4 9.93 13.57 9.34 13.7 8.68 13.77 7.96 13.8 7.61 13.79 7.25 13.78 6.9 13.75 6.54 13.71 6.19 13.66 5.83 13.6 5.47 13.52 5.11 13.44 4.76 13.35 4.4 13.24 4.04 13.13 3.69 13 3.69 10.56 4.04 10.75 4.39 10.91 4.74 11.06 5.08 11.2 5.42 11.32 5.76 11.42 6.09 11.51 6.42 11.58 6.74 11.64 7.06 11.68 7.37 11.7 7.69 11.71 7.99 11.7 8.27 11.68 8.52 11.63 8.75 11.57 8.95 11.49 9.13 11.4 9.28 11.28 9.41 11.16 9.51 11.01 9.58 10.86 9.62 10.68 9.63 10.5 9.62 10.33 9.59 10.17 9.55 10.03 9.48 9.91 9.4 9.79 9.29 9.69 9.16 9.6 8.99 9.51 8.78 9.42 8.73 9.4Z"/><path d="M1.7 7.3H14.3A.7 .7 0 0 1 15 8V8A.7 .7 0 0 1 14.3 8.7H1.7A.7 .7 0 0 1 1 8V8A.7 .7 0 0 1 1.7 7.3Z"/></svg>';
  // A highlight: a marker nib over the wash it lays down, the wash drawn
  // faint so the nib reads first. C of three on the same sheet.
  const HIGHLIGHT_ICON =
    '<svg viewBox="0 0 16 16"><path d="M11.9 1.3 14.6 4.0 7.9 10.7 5.2 8.0Z"/><path d="M4.6 8.6 7.3 11.3 3.3 12.4 1.9 11.0Z"/><rect x="1" y="13.4" width="14" height="2.1" rx="1.05" fill-opacity="0.32"/></svg>';
  // Superscript and subscript: the letter and its figure, which is what
  // every word processor draws and the one shape a reader does not have to
  // be told (design-annotation-icons.html, A of three, the owner's pick).
  // The X reads widest at 15px of the three letters offered; the figure is
  // DejaVu Sans Bold traced to a path, as the strikethrough's S was, and
  // the two are mirror images about y=8, so the pair reads as one gesture
  // in two directions.
  const SUP_ICON =
    '<svg viewBox="0 0 16 16"><path d="M7.09 8.41 10.14 12.9H7.78L5.72 9.89L3.68 12.9H1.31L4.36 8.41L1.42 4.1H3.79L5.72 6.94L7.64 4.1H10.02Z"/><path d="M12.36 5.69H14.69V6.7H10.84V5.69L12.78 3.99Q13.04 3.75 13.16 3.53Q13.28 3.3 13.28 3.06Q13.28 2.69 13.03 2.46Q12.78 2.23 12.37 2.23Q12.05 2.23 11.67 2.37Q11.29 2.51 10.85 2.78V1.61Q11.32 1.46 11.77 1.38Q12.22 1.3 12.65 1.3Q13.6 1.3 14.13 1.72Q14.66 2.14 14.66 2.89Q14.66 3.32 14.44 3.7Q14.21 4.07 13.49 4.7Z"/></svg>';
  const SUB_ICON =
    '<svg viewBox="0 0 16 16"><path d="M7.09 7.01 10.14 11.5H7.78L5.72 8.49L3.68 11.5H1.31L4.36 7.01L1.42 2.7H3.79L5.72 5.54L7.64 2.7H10.02Z"/><path d="M12.36 13.69H14.69V14.7H10.84V13.69L12.78 11.99Q13.04 11.75 13.16 11.53Q13.28 11.3 13.28 11.06Q13.28 10.69 13.03 10.46Q12.78 10.23 12.37 10.23Q12.05 10.23 11.67 10.37Q11.29 10.51 10.85 10.78V9.61Q11.32 9.46 11.77 9.38Q12.22 9.3 12.65 9.3Q13.6 9.3 14.13 9.72Q14.66 10.14 14.66 10.89Q14.66 11.32 14.44 11.7Q14.21 12.07 13.49 12.7Z"/></svg>';
  // Small caps: a lowercase a and the small cap it becomes, which is what
  // the button does to a selection. The owner picked it on 2026-09-19 (G of
  // design/design-smallcaps-icon.html, kept over the six of
  // design/design-smallcaps-icon-2.html), and it replaces the stacked pair
  // of T that shipped unreleased before it.
  //
  // The pair is in a row, which is the heading button's arrangement, so what
  // has to keep the two apart is no longer the arrangement but the letters:
  // the heading sets one shape at two heights and this sets two shapes at
  // one height, 6.93 of the 16 box each, since a small cap IS a capital at
  // the x-height. That is also why the row survived where `Aa` did not.
  // Placement is measured (design/design-smallcaps-placement.html): the
  // drawing came off the round 1 sheet sitting low in its square and 0.08
  // over the right edge, so it is grown 5%, which is as large as a pair this
  // wide goes, and sat on y 13.6 so it shares a baseline with the H, the B
  // and the I instead of floating above theirs.
  //
  // Drawn and not taken, over the two rounds: one cap crossed by the
  // small-cap line and the pair under a cap line, both read as the
  // strikethrough two buttons away; the word abstracted into strokes, which
  // reads as a bar chart, and the same word in letters, which merges at
  // 15px; the small cap tucked under the cap's arm, which is the subscript
  // button's composition; and one stem with two arms, which reads as a
  // currency mark.
  const SMALLCAPS_ICON =
    '<svg viewBox="0 0 16 16"><path d="M3.85 10.46Q3.19 10.46 2.86 10.68Q2.53 10.91 2.53 11.34Q2.53 11.74 2.79 11.97Q3.06 12.2 3.54 12.2Q4.14 12.2 4.55 11.77Q4.94 11.34 4.94 10.7V10.46ZM7.08 9.66V13.43H4.94V12.46Q4.52 13.05 3.99 13.33Q3.46 13.6 2.7 13.6Q1.68 13.6 1.04 13Q0.4 12.4 0.4 11.45Q0.4 10.29 1.2 9.75Q1.99 9.21 3.71 9.21H4.94V9.04Q4.94 8.54 4.56 8.31Q4.16 8.08 3.32 8.08Q2.65 8.08 2.06 8.21Q1.48 8.35 0.98 8.61V7.01Q1.66 6.85 2.34 6.75Q3.02 6.67 3.71 6.67Q5.49 6.67 6.28 7.37Q7.08 8.08 7.08 9.66Z"/><path d="M13.37 12.17H10.57L10.13 13.43H8.34L10.9 6.5H13.03L15.6 13.43H13.81ZM11.01 10.88H12.91L11.97 8.13Z"/></svg>';
  // The six of the Insert group, each the glyph the owner picked for it on
  // the same sheet. The equation is the radical with its bar, faint under the
  // hook where the maths goes; the block twin is that radical between the
  // two rules of the fence, as the code block is the chevrons between
  // them. The table is two columns and three rows, the head solid and the
  // rows it takes faint. The picture is the frame with the sun and the hill
  // inside it, the drawing every viewer uses. The footnote is a word with
  // its raised figure, which is what a reference is. The rule is the stroke
  // between two lines of text, so it reads as a rule and not as a bar.
  const EQUATION_ICON =
    '<svg viewBox="0 0 16 16"><path d="M7.15 3H8.37V3.85H7.83L4.46 13H3.79L2.04 8.18L1.21 8.49L1 7.76L3.05 7.03L4.32 10.65Z"/><rect x="7.87" y="3" width="6.93" height="0.95" rx="0.47"/><rect x="9" y="7.4" width="4.6" height="1.6" rx="0.8" fill-opacity="0.45"/></svg>';
  const EQUATION_BLOCK_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="1.4" rx="0.7"/><path d="M5.83 4.4H6.71V5.01H6.31L3.89 11.6H3.41L2.15 8.13L1.55 8.35L1.4 7.83L2.88 7.3L3.79 9.91Z"/><rect x="6.31" y="4.4" width="7.29" height="0.8" rx="0.4"/><rect x="7.4" y="7.8" width="3.8" height="1.3" rx="0.65" fill-opacity="0.45"/><rect x="1" y="13.6" width="14" height="1.4" rx="0.7"/></svg>';
  const TABLE_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="1.5" width="6.25" height="3.33" rx="0.55"/><rect x="8.75" y="1.5" width="6.25" height="3.33" rx="0.55"/><rect x="1" y="6.33" width="6.25" height="3.33" rx="0.55" fill-opacity="0.45"/><rect x="8.75" y="6.33" width="6.25" height="3.33" rx="0.55" fill-opacity="0.45"/><rect x="1" y="11.17" width="6.25" height="3.33" rx="0.55" fill-opacity="0.45"/><rect x="8.75" y="11.17" width="6.25" height="3.33" rx="0.55" fill-opacity="0.45"/></svg>';
  const PICTURE_ICON =
    '<svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2.6 2.2h10.8a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H2.6a1.6 1.6 0 0 1-1.6-1.6V3.8a1.6 1.6 0 0 1 1.6-1.6Zm-.2 2.05v7.5a.55.55 0 0 0 .55.55h10.1a.55.55 0 0 0 .55-.55v-7.5a.55.55 0 0 0-.55-.55H2.95a.55.55 0 0 0-.55.55Z"/><circle cx="5.4" cy="6.3" r="1.25"/><path d="M3.0 11.8 6.7 7.6 9.0 10.2 10.7 8.4 13.4 11.8Z"/></svg>';
  const FOOTNOTE_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="8.6" width="8.4" height="1.9" rx="0.95"/><path d="M10.63 6.8H11.91V3.18L10.6 3.45V2.47L11.9 2.2H13.27V6.8H14.55V7.8H10.63Z"/></svg>';
  const RULE_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="1.3" width="14" height="1.4" rx="0.7" fill-opacity="0.45"/><rect x="1" y="4" width="10.5" height="1.4" rx="0.7" fill-opacity="0.45"/><rect x="1" y="7.2" width="14" height="2.1" rx="1.05"/><rect x="1" y="11.4" width="14" height="1.4" rx="0.7" fill-opacity="0.45"/><rect x="1" y="14.1" width="8.5" height="1.4" rx="0.7" fill-opacity="0.45"/></svg>';
  // A quote: the bar the editor draws down a quote's left side, running past
  // two rows of text. Fourth of the block group and built like the other
  // three (see LIST_ICON): the task glyph's own bars at its rows of 4 and 12,
  // and the marker in the column its check and box stand in. Three rows of
  // thin bars was what it had, and beside the three that were rebuilt it was
  // the odd one out. The marker is one rule and not one a row: a quote's bar
  // is a single line down the whole of it, which is what the editor draws
  // and what the owner asked to keep (2026-09-19).
  const QUOTE_ICON =
    '<svg viewBox="0 0 16 16"><rect x="2.6" y="1.6" width="1.6" height="12.8" rx=".8"/><path d="M8.2 3.3H13.8A.7 .7 0 0 1 14.5 4V4A.7 .7 0 0 1 13.8 4.7H8.2A.7 .7 0 0 1 7.5 4V4A.7 .7 0 0 1 8.2 3.3Z"/><path d="M8.2 11.3H13.8A.7 .7 0 0 1 14.5 12V12A.7 .7 0 0 1 13.8 12.7H8.2A.7 .7 0 0 1 7.5 12V12A.7 .7 0 0 1 8.2 11.3Z"/></svg>';
  // A task list: two rows of the list glyph, a done task and one to do: a
  // check mark alone where the bullet goes, then an empty box (same sheet,
  // A, changed by the owner: a tick cut out of a box was too small to be
  // seen at 15px). The mark is drawn at the bars' 1.45 weight.
  const TASK_ICON =
    '<svg viewBox="0 0 16 16"><path d="M1.71 3.79 2.8 4.88 5.34 1.84 6.46 2.76 2.9 7.02 .69 4.81Z"/><path d="M8.2 3.3H13.8A.7 .7 0 0 1 14.5 4V4A.7 .7 0 0 1 13.8 4.7H8.2A.7 .7 0 0 1 7.5 4V4A.7 .7 0 0 1 8.2 3.3Z"/><path d="M2 9.6H4.8A1 1 0 0 1 5.8 10.6V13.4A1 1 0 0 1 4.8 14.4H2A1 1 0 0 1 1 13.4V10.6A1 1 0 0 1 2 9.6ZM2.3 11.2V12.8A.3 .3 0 0 0 2.6 13.1H4.2A.3 .3 0 0 0 4.5 12.8V11.2A.3 .3 0 0 0 4.2 10.9H2.6A.3 .3 0 0 0 2.3 11.2Z"/><path d="M8.2 11.3H13.8A.7 .7 0 0 1 14.5 12V12A.7 .7 0 0 1 13.8 12.7H8.2A.7 .7 0 0 1 7.5 12V12A.7 .7 0 0 1 8.2 11.3Z"/></svg>';
  // The Ctrl+D toggle: two text carets standing on a word, drawn as a faint
  // bar. What the icon names is the family the button belongs to, the
  // multicursor, and not the mode in force: which of the two modes is on is
  // said by the disc of mdm-btn--on and by the tooltip, as it is on the staff,
  // alignment and header buttons. The drawing before this one was a selection
  // box around the middle of the bar, for "a part inside a word", and at the
  // 15px the toolbar draws at it read as a code block, or as a minus sign shut
  // in a box. Fill only, since the toolbar stylesheet zeroes strokes: each
  // caret is three rounded rectangles (two serifs and a stem) and the word is
  // drawn faint with fill-opacity.
  const MULTICURSOR_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1.5" y="11.6" width="13" height="2" rx="1" fill-opacity="0.4"/><rect x="3.2" y="2.4" width="3.6" height="1.3" rx=".65"/><rect x="4.35" y="2.4" width="1.3" height="7.8" rx=".2"/><rect x="3.2" y="8.9" width="3.6" height="1.3" rx=".65"/><rect x="9.2" y="2.4" width="3.6" height="1.3" rx=".65"/><rect x="10.35" y="2.4" width="1.3" height="7.8" rx=".2"/><rect x="9.2" y="8.9" width="3.6" height="1.3" rx=".65"/></svg>';
  // A stack of headings, longest at the top: the document's own table of
  // contents, the glyph an outline has always carried.
  const OUTLINE_ICON =
    '<svg viewBox="0 0 16 16"><rect x="1" y="2.4" width="10" height="1.6" rx=".8"/><rect x="3.5" y="6.2" width="9.5" height="1.6" rx=".8"/><rect x="3.5" y="10" width="6.5" height="1.6" rx=".8"/><circle cx="1.6" cy="7" r="1"/><circle cx="1.6" cy="10.8" r="1"/></svg>';

  // The headings of the document, read from the Lezer tree so a `#` inside a
  // code block or an equation is not mistaken for one. Both Markdown heading
  // forms are covered: ATX (`## Title`) and Setext (a line underlined with
  // `===` or `---`). Each entry carries the level, the heading's inline
  // content as parts (the same reading a table cell gets: the marks gone,
  // a link its label, an equation set), its plain text for the tooltip, and
  // the position to jump to (the start of the heading line). The tree may be
  // one parsed further than the state's own (the panel asks for the whole
  // document). What is read is what the editor draws (G112, G113): the
  // closing `#` run is the one the parser marks, so `Sonata in F#` keeps its
  // sharp, a setext heading of two lines is whole, and an attribute block
  // written on the heading (`{#sec-x}`) is left off the row, as Pandoc's
  // table of contents leaves it. Headings inside quotes and list items are
  // listed, as VS Code's outline lists them; Pandoc's contents leave them
  // out, a difference on the record in tests/README.md.
  function outlineHeadings(state, tree) {
    const text = function (from, to) {
      return state.doc.sliceString(from, to);
    };
    const out = [];
    const walked = tree || CM.syntaxTree(state);
    const refs = definitionsOf(state, walked);
    walked.iterate({
      enter: function (node) {
        let level = 0;
        const m = /^ATXHeading([1-6])$/.exec(node.name);
        if (m) level = Number(m[1]);
        else if (node.name === "SetextHeading1") level = 1;
        else if (node.name === "SetextHeading2") level = 2;
        if (!level) return;
        const parts = cellParts(node.node, text, LINK_SKIP, smartMarks(node.node, headingTextEnd(node, text), text), refs);
        // Line breaks of a setext heading read as spaces, and a trailing
        // attribute block goes with the space before it.
        parts.forEach(function (p) {
          if (p.kind === "text") p.text = p.text.replace(/[\r\n]+/g, " ");
        });
        const last = parts.length ? parts[parts.length - 1] : null;
        if (last && last.kind === "text") last.text = last.text.replace(/\s*\{[^{}]*\}\s*$/, "");
        if (parts.length && parts[0].kind === "text") parts[0].text = parts[0].text.replace(/^\s+/, "");
        if (last && last.kind === "text") last.text = last.text.replace(/\s+$/, "");
        const plain = partsText(parts).trim();
        out.push({
          level: level,
          pos: state.doc.lineAt(node.from).from,
          parts: plain ? parts : [{ kind: "text", text: "(untitled)" }],
          text: plain || "(untitled)",
        });
        return false;
      },
    });
    return out;
  }

  // The panel lists the whole document, and the parser stops short of it:
  // CodeMirror parses the viewport and 100000 characters past it, and the
  // panel opened at startup read the first 3000 alone, the rest arriving
  // with the background parse that nothing listened to (G111). So while the
  // panel is open and the parse is not done, the rest is parsed for the
  // panel in slices of 40 ms between frames, and the list is drawn from the
  // tree each slice reaches, until it reaches the end. One mechanism and
  // not three: a refresh on every transaction the background parse lands,
  // and a forced slice inside every refresh, both covered the same ground
  // and neither could be seen to fail (tests/README.md).
  let outlineParse = 0;
  function parseForOutline() {
    if (!view || !outlineOpen) return;
    const state = view.state;
    if (CM.syntaxTreeAvailable(state, state.doc.length)) return;
    const seq = ++outlineParse;
    setTimeout(function () {
      if (seq !== outlineParse || !view || !outlineOpen) return;
      const tree = CM.ensureSyntaxTree(view.state, view.state.doc.length, 40);
      refreshOutline(tree || CM.syntaxTree(view.state));
    }, 16);
  }

  // The outline is a panel down the left edge of the editor, the way the
  // Vditor version had it: a list of the headings, indented by level, the
  // section the caret is in marked, each one a jump. It is a toggle, not a
  // drop-down: it stays open while the document is navigated, and its button
  // leads the toolbar, on the side the panel appears.
  //
  // Open or shut is a setting (mdm.outline), as is how wide it is opened
  // (mdm.outlineWidth): the panel comes back the way it was left, here and in
  // the next document opened.
  let outlineOpen = SETTINGS.outline === "shown";

  function outlineList() {
    return document.querySelector("#app .mdm-outline__list");
  }

  // A few pixels of air over a heading jumped to, so the line does not sit
  // flush against the toolbar.
  const OUTLINE_JUMP_AIR = 8;

  // Fills the panel from the current headings, only while it is open. Called
  // when it opens and on every edit or caret move, so the list and the mark on
  // the section in view stay current.
  //
  // One row per heading, indented by level, the current section (the last
  // heading at or above the caret) marked. A click takes the caret to the top
  // of that heading and pulls the heading up to the top of the pane, so the
  // section starts where the eye already is, the way a table of contents lands
  // on a page. Near the foot of the document, where what is left below a
  // heading cannot fill the pane, the scroll clamps on its own: the heading
  // lands as high as it can and the document ends at the bottom edge.
  // The rows on screen, as painted: where each heading stands and the row
  // drawn for it. A caret that moves marks another row and paints nothing;
  // the rows are painted again when the text changes, once the typing rests.
  // Painted at every keystroke and every arrow key, a document of 2750
  // headings walked the whole tree and built 2750 buttons each time.
  let outlineHeads = [];
  let outlineTimer = null;
  const OUTLINE_REST = 120;

  function markCurrentOutline() {
    const list = outlineList();
    if (!list || !outlineOpen || !view) return;
    const caret = view.state.selection.main.head;
    let current = -1;
    outlineHeads.forEach(function (h, i) {
      if (h.pos <= caret) current = i;
    });
    const marked = list.querySelector(".mdm-outline__row--current");
    const row = current >= 0 ? list.children[current] : null;
    if (marked === row) return;
    if (marked) marked.classList.remove("mdm-outline__row--current");
    if (row) row.classList.add("mdm-outline__row--current");
  }

  // After a change to the text: the headings on screen keep their places in
  // the text meanwhile (a row clicked before the rows are painted again still
  // jumps to its heading), and one painting follows a run of keystrokes.
  function outlineAfterChange(changes) {
    outlineHeads.forEach(function (h) {
      h.pos = changes.mapPos(h.pos, 1);
    });
    if (outlineTimer) clearTimeout(outlineTimer);
    outlineTimer = setTimeout(function () {
      outlineTimer = null;
      refreshOutline();
    }, OUTLINE_REST);
  }

  function refreshOutline(parsed) {
    const list = outlineList();
    if (!list || !outlineOpen || !view) return;
    // The state's own tree, or the one a slice parsed further for the panel.
    const state = view.state;
    const heads = outlineHeadings(state, parsed || null);
    outlineHeads = heads;
    const caret = state.selection.main.head;
    parseForOutline();
    let current = -1;
    heads.forEach(function (h, i) {
      if (h.pos <= caret) current = i;
    });
    list.innerHTML = "";
    if (!heads.length) {
      const empty = document.createElement("div");
      empty.className = "mdm-outline__empty";
      empty.textContent = "No headings";
      list.appendChild(empty);
      return;
    }
    heads.forEach(function (h, i) {
      const row = document.createElement("button");
      row.type = "button";
      row.className =
        "mdm-outline__row mdm-outline__l" + h.level +
        (i === current ? " mdm-outline__row--current" : "");
      row.style.paddingLeft = 8 + (h.level - 1) * 14 + "px";
      paintParts(row, h.parts);
      row.title = h.text;
      row.addEventListener("click", function () {
        if (!view) return;
        view.dispatch({
          selection: { anchor: h.pos },
          effects: EditorView.scrollIntoView(h.pos, {
            y: "start",
            yMargin: OUTLINE_JUMP_AIR,
          }),
        });
        view.focus();
      });
      list.appendChild(row);
    });
  }

  // The panel is a flex sibling of the text, so opening it, closing it or
  // dragging its sash moves the whole column sideways without touching a line
  // of the document. CodeMirror draws the caret and the selection as boxes of
  // its own, placed from coordinates measured against the geometry that was
  // there before, and it does not measure again until its resize observer
  // notices: five frames, measured on a caret held at the head of a heading.
  // For those five the caret stands where the column used to be, which coming
  // back from an open panel is out in the dead margin, 93px left of the line
  // and well left of its number. Asking for the measure here spends it in the
  // frame the width is written in.
  function remeasureText() {
    if (view) view.requestMeasure();
  }

  // The panel drawn from the setting in force: the class that shows it, the
  // lit button, and the list, which is only filled while it is open.
  function applyOutline() {
    const root = app();
    if (root) root.classList.toggle("mdm-outline--open", outlineOpen);
    const btn = document.querySelector('#app button[data-type="outline"]');
    if (btn) btn.classList.toggle("mdm-btn--on", outlineOpen);
    if (outlineOpen) refreshOutline();
    remeasureText();
  }

  // ---------- The width of the outline ----------

  // The panel opens at the width the grip beside it was last dragged to, the
  // sash of a side panel. What the drag writes is a custom property on #app,
  // and what it leaves behind on the drop is the setting, so the panel is as
  // wide in the next document as in this one.
  const OUTLINE_MIN = 140;
  // The ceiling extension.js clamps mdm.outlineWidth to as well, so a width
  // that comes back from the host is one the grip could have reached.
  const OUTLINE_MAX = 1200;
  const EDITOR_MIN = 200;
  let outlineWidth = SETTINGS.outlineWidth || 250;

  // The editor keeps a column of its own whatever the setting says: a width
  // dragged out on a wide window would otherwise swallow the pane on a narrow
  // one. The setting is left alone, so the panel goes back to its full width
  // as soon as there is room for it again.
  function applyOutlineWidth() {
    const root = app();
    if (!root) return;
    const body = document.querySelector("#app .mdm-body");
    const room = body ? body.getBoundingClientRect().width - EDITOR_MIN : Infinity;
    const width = Math.max(OUTLINE_MIN, Math.min(outlineWidth, room));
    root.style.setProperty("--mdm-outline-width", Math.round(width) + "px");
    remeasureText();
  }

  // The pane can be resized under an open panel (the editor group dragged
  // narrower, the window itself), so the fit is worked out again whenever it
  // changes. Only the width on screen moves; the setting stays where the grip
  // left it.
  function watchOutlineRoom() {
    window.addEventListener("resize", applyOutlineWidth);
  }

  // The player row spans the toolbar, so the pane getting narrower or wider
  // is the one thing that changes its width. Everything in the row answers
  // that by itself, in CSS: the track is a flex child that absorbs what is
  // left (abcjs's own sheet), the fill is a percentage of it, and what has to
  // go at the narrow end goes by media query (style.css). The single piece
  // that cannot is the progress head, placed in pixels; see the note in
  // makeProgressDraggable. The window's own resize is what the editor already
  // listens to for the outline, so this is the same event, not a second
  // mechanism: nothing else in the page resizes the toolbar (the outline
  // panel sits below it and takes width from the text alone).
  function watchPlayerWidth() {
    window.addEventListener("resize", function () {
      if (player && player.repaint) player.repaint();
    });
  }

  function makeOutlineGrip(grip, body) {
    grip.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      const root = app();
      const box = body.getBoundingClientRect();
      // The editor keeps a column of its own wherever the sash is dragged to.
      const most = Math.min(OUTLINE_MAX, Math.max(OUTLINE_MIN, box.width - EDITOR_MIN));
      let width = outlineWidth;
      const drag = function (ev) {
        width = Math.min(most, Math.max(OUTLINE_MIN, ev.clientX - box.left));
        root.style.setProperty("--mdm-outline-width", Math.round(width) + "px");
        // Every frame of the drag moves the column, so every frame of it has
        // to be measured; a sash dragged slowly otherwise drags a caret that
        // trails a hand's width behind the text.
        remeasureText();
      };
      const drop = function () {
        root.classList.remove("mdm-resizing");
        grip.classList.remove("mdm-outline__grip--held");
        grip.removeEventListener("pointermove", drag);
        grip.removeEventListener("pointerup", drop);
        grip.removeEventListener("pointercancel", drop);
        // Written once, on the drop: a setting per frame of the drag would be
        // a hundred writes to settings.json for one gesture. The panel is
        // already at that width, so what comes back changes nothing on screen.
        askSetting("outlineWidth", Math.round(width));
      };
      // The press is not prevented, so the click still counts as one made
      // outside the text (dismissFromOutside); what a drag would otherwise
      // select on its way is held off by the class instead.
      root.classList.add("mdm-resizing");
      grip.classList.add("mdm-outline__grip--held");
      try {
        grip.setPointerCapture(e.pointerId);
      } catch (err) {
        // a pointer the browser has already let go of
      }
      grip.addEventListener("pointermove", drag);
      grip.addEventListener("pointerup", drop);
      grip.addEventListener("pointercancel", drop);
    });
  }

  // The button asks the host, the way every other button that holds a state
  // does; the panel opens when the setting comes back. The keyboard goes back
  // to the text at once: that is the click's doing, not the setting's.
  function toggleOutline() {
    askSetting("outline", outlineOpen ? "hidden" : "shown");
    if (view) view.focus();
  }

  // The second modifier every block key carries: Shift on a PC, Option on a
  // Mac. Not Shift on a Mac, where the system takes Cmd+Shift+3, 4 and 5 for
  // its screenshots and Cmd+Shift+Q logs the account out; Notion binds its
  // own row to Cmd+Option for the same reason, and the code block was bound
  // that way before this row existed.
  const BLOCK_MOD = { pc: "Shift", mac: "Alt" };

  // The name of a shortcut as VS Code writes it on the platform in use, for
  // a button's tip and for a menu row, which have to agree. Written from the
  // test CodeMirror reads `Mod` with (/Mac/ on navigator.platform; its iOS
  // branch cannot run in a webview), so a tip cannot name Ctrl where the
  // binding answers to Cmd.
  function shortcutLabel(key, also) {
    const mac = /Mac/.test(navigator.platform);
    const second = also ? also[mac ? "mac" : "pc"] : "";
    return mac
      ? (second ? { Alt: "\u2325", Shift: "\u21e7" }[second] : "") + "\u2318" + key
      : "Ctrl+" + (second ? second + "+" : "") + key;
  }

  // A button of the bar. `menu` is a list of entries for a drop-down panel:
  // {name, label (HTML), click}; the panel opens on click and closes on a
  // click anywhere else or on Escape.
  function toolbarButton(spec) {
    const item = document.createElement("div");
    item.className = "mdm-toolbar__item";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mdm-btn mdm-tip mdm-tip--s";
    btn.setAttribute("data-type", spec.name);
    if (spec.key) {
      const mac = /Mac/.test(navigator.platform);
      const also = spec.also ? spec.also[mac ? "mac" : "pc"] : "";
      btn.setAttribute("aria-label", spec.tip + " (" + shortcutLabel(spec.key, spec.also) + ")");
      btn.setAttribute("aria-keyshortcuts", (mac ? "Meta+" : "Control+") + (also ? also + "+" : "") + spec.key);
    } else {
      btn.setAttribute("aria-label", spec.tip);
    }
    // A button that works on the selection is exempt from dismissFromOutside.
    if (spec.caret) btn.classList.add("mdm-btn--caret");
    btn.innerHTML = spec.icon;
    item.appendChild(btn);
    if (spec.menu || spec.build) {
      const panel = document.createElement("div");
      panel.className = "mdm-menu";
      // A panel whose rows work on the selection (the heading levels) is
      // exempt with its button: a press on a row put the block being edited
      // away before the row could find the lines it was for.
      if (spec.caret) panel.classList.add("mdm-btn--caret");
      item.appendChild(panel);
      // What each row can do is read again every time the panel opens, not
      // once when it is filled: the Audio rows of the export panel grey out
      // in a document with no score, and a document gains and loses scores as
      // it is written. Only a panel being looked at is worth the reading.
      const rows = new Map();
      const refresh = function () {
        rows.forEach(function (entry, row) {
          const off = !!(entry.off && entry.off());
          row.classList.toggle("mdm-menu__item--off", off);
          row.disabled = off;
        });
      };
      const fill = function (entries) {
        panel.innerHTML = "";
        rows.clear();
        (entries || []).forEach(function (entry) {
          // A header, and the quiet line that may follow it, name the branch
          // the rows under them belong to. Neither is a row: they take no
          // press and carry no data-type, so nothing that reads the panel's
          // buttons finds them.
          if (entry.head) {
            const head = document.createElement("div");
            head.className = "mdm-menu__head";
            head.textContent = entry.head;
            panel.appendChild(head);
            if (entry.note) {
              const note = document.createElement("div");
              note.className = "mdm-menu__note";
              note.textContent = entry.note;
              panel.appendChild(note);
            }
            return;
          }
          const row = document.createElement("button");
          row.type = "button";
          row.className = "mdm-menu__item" + (entry.className ? " " + entry.className : "");
          row.setAttribute("data-type", entry.name);
          row.innerHTML = entry.label;
          row.addEventListener("click", function (e) {
            e.stopPropagation();
            closeMenus();
            entry.click();
          });
          rows.set(row, entry);
          panel.appendChild(row);
        });
        refresh();
        if (!panel.children.length && spec.empty) {
          const note = document.createElement("div");
          note.className = "mdm-menu__empty";
          note.textContent = spec.empty;
          panel.appendChild(note);
        }
      };
      // A fixed list is filled once; a `build` panel (the outline, whose
      // headings change as the document is edited) is rebuilt each time it
      // opens.
      if (spec.menu) fill(spec.menu);
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const open = item.classList.contains("mdm-toolbar__item--open");
        closeMenus();
        if (!open) {
          if (spec.build) fill(spec.build());
          else refresh();
          item.classList.add("mdm-toolbar__item--open");
        }
        // The bar is not somewhere to be: the focus goes back to the text, as
        // it does from the buttons that act on the caret. Without this the
        // press left the document unfocused, and unfocused it draws itself
        // with nobody in it, so opening a menu would have closed the block
        // being edited behind the panel.
        if (view) view.focus();
      });
    } else {
      btn.addEventListener("click", function () {
        closeMenus();
        spec.click();
        if (view) view.focus();
      });
    }
    // The tooltip goes away on a click, the manners of the whole editor now
    // (dismissTip, on the document); this button never needed any of its own.
    // A pointer click leaves the button focused, and a focused button keeps
    // its tooltip up; the focus goes back to the text. Keyboard users (detail
    // 0) keep theirs.
    btn.addEventListener("mouseup", function (e) {
      if (e.detail > 0) setTimeout(function () { btn.blur(); }, 0);
    });
    return item;
  }

  function closeMenus() {
    document.querySelectorAll("#app .mdm-toolbar__item--open").forEach(function (el) {
      el.classList.remove("mdm-toolbar__item--open");
    });
  }

  function separator() {
    const el = document.createElement("span");
    el.className = "mdm-toolbar__sep";
    return el;
  }

  // The end of a row of the bar. The toolbar wraps, so a child that asks for
  // the whole width takes what is left of the line with it and the next
  // button starts a row of its own, which is how the player's row sits under
  // the buttons (mountPlayer). It draws nothing: where a row ends is said by
  // the row ending.
  function rowBreak() {
    const el = document.createElement("span");
    el.className = "mdm-toolbar__break";
    return el;
  }

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "mdm-toolbar";
    const run = function (cmd) {
      return function () {
        if (view) cmd(view);
      };
    };
    const specs = [
      // Outline leads the bar: its panel opens down the left edge, so the
      // button sits on the side the panel appears (as in the Vditor version).
      {
        name: "outline",
        icon: OUTLINE_ICON,
        tip: "Outline",
        click: toggleOutline,
      },
      "|",
      // The export menu next: the one button that leaves the editor. It has
      // two branches, and the headers are what tells them apart. Document is
      // the page: the host saves the file first, then runs the same bin/mdm
      // the command line uses. Audio is the music: the editor renders it
      // itself, one file per score, and needs nothing installed.
      //
      // The line under the Audio header is there because the rail of every
      // score carries this same icon: pressed there it writes that one score,
      // pressed here it writes them all, and the panel is the cheapest place
      // to say so.
      {
        name: "mdm-export",
        icon: EXPORT_ICON,
        tip: "Export",
        menu: [{ head: "Document" }]
          .concat(
            EXPORT_FORMATS.map(function (format) {
              return {
                name: "mdm-export-" + format.to,
                label: format.label,
                click: function () {
                  vscode.postMessage({ type: "export", to: format.to });
                },
              };
            })
          )
          .concat([{ head: "Audio", note: "one file per score" }])
          .concat(
            AUDIO_FORMATS.map(function (format) {
              return {
                name: "mdm-export-" + format.to,
                label: format.label,
                // Nothing to write in a document with no score, said the way
                // the header button of a file with no YAML says it.
                off: function () {
                  return scoreless(view && view.state);
                },
                click: function () {
                  exportAudio(format.to);
                },
              };
            })
          ),
      },
      "|",
      { name: "undo", icon: UNDO_ICON, tip: "Undo", click: run(CM.undo) },
      { name: "redo", icon: REDO_ICON, tip: "Redo", click: run(CM.redo) },
      "|",
      { name: "headings", icon: HEADING_ICON, tip: "Heading", build: headingMenuItems, caret: true },
      // `key` is the letter of the Mod- binding the button shares (the
      // keymap above), named in the tip so the shortcut can be found.
      { name: "bold", icon: BOLD_ICON, tip: "Bold", key: "B", click: run(toggleInline("**")), caret: true },
      { name: "italic", icon: ITALIC_ICON, tip: "Italic", key: "I", click: run(toggleInline("*")), caret: true },
      // No key yet: D19 in docs/cm6-migration.md.
      // The highlight, after the strikethrough: the last of the marks that
      // colour words rather than shape them, and Pandoc's bracketed span
      // `[x]{.mark}`. It takes no key; the letters that would read as its own
      // are spent or taken (D19).
      //
      // Its twin, an underline button writing `[x]{.underline}`, was fitted
      // beside it on 2026-09-19 and taken off the same day (the owner's call).
      // Two reasons, in his order: a bracketed span leaks its class name into
      // any reader that is not Pandoc, where `[word]{.underline}` shows as
      // those characters and not as a word (the superscript at least leaves
      // `2^nd^` readable), and this one buys nothing the bar has not got,
      // since an underline is the typewriter's italic and this editor sets in
      // Latin Modern through TeX. The highlight pays the same toll for
      // something italic cannot do, which is to point without changing the
      // voice. What stays behind is the reading: `.mdm-underline` in
      // style.css, because the page underlines the span whether or not a
      // button writes it (the Span branch above).
      { name: "strikethrough", icon: STRIKE_ICON, tip: "Strikethrough", click: run(toggleInline("~~")), caret: true },
      // The superscript and the subscript next, a pair of their own and
      // still a pair of marks like the three before them (`^x^`, `~x~`),
      // and then the two bracketed spans, which are written with an
      // attribute and not with punctuation: small caps and the highlight,
      // the same gesture twice (toggleSpan). The owner set this order on
      // 2026-09-19, moving the two scripts up off the spans. None of the
      // four takes a key (D19).
      { name: "superscript", icon: SUP_ICON, tip: "Superscript", click: run(toggleInline("^")), caret: true },
      { name: "subscript", icon: SUB_ICON, tip: "Subscript", click: run(toggleInline("~")), caret: true },
      { name: "small-caps", icon: SMALLCAPS_ICON, tip: "Small caps", click: run(toggleSpan("smallcaps")), caret: true },
      { name: "highlight", icon: HIGHLIGHT_ICON, tip: "Highlight", click: run(toggleSpan("mark")), caret: true },
      { name: "link", icon: LINK_ICON, tip: "Link", key: "K", click: run(insertLink), caret: true },
      // Inline code last of the marks and the code block first of the
      // blocks, so the two chevrons stand beside each other with only the
      // separator between them: one is a mark on words inside a line and the
      // other makes the line a block, which is the cut the separator is
      // there to make, and it is the cut the keys make too (a letter for the
      // words, the letter under BLOCK_MOD for what the line is).
      { name: "inline-code", icon: CODE_ICON, tip: "Inline code", key: "E", click: run(toggleInline("`")), caret: true },
      "|",
      { name: "code-block", icon: CODE_BLOCK_ICON, tip: "Code block", key: "C", also: BLOCK_MOD, click: run(toggleCodeBlock), caret: true },
      { name: "unordered-list", icon: LIST_ICON, tip: "Unordered list", click: run(toggleList(false)), caret: true },
      { name: "ordered-list", icon: OLIST_ICON, tip: "Ordered list", click: run(toggleList(true)), caret: true },
      { name: "task-list", icon: TASK_ICON, tip: "Task list", key: "T", also: BLOCK_MOD, click: run(toggleTask), caret: true },
      { name: "quote", icon: QUOTE_ICON, tip: "Quote", click: run(toggleQuote), caret: true },
      // A cut of their own, and then the six that were the Insert menu, as
      // buttons closing the row: what a document holds beside its words, in
      // the order a reader meets it (the maths inline and on lines of its
      // own, then the table, the picture, the note and the rule). One button
      // held them while the bar was one row, and the row is what they cost:
      // the owner asked to see the bar in two, so they are spelled out here
      // and what follows opens the second row ("/" below). The separator is
      // his call as well: the buttons before it change what a line already
      // is, these put something new in the document, and two gestures that
      // different do not share a run.
      "|",
      { name: "insert-equation", icon: EQUATION_ICON, tip: "Equation", click: run(toggleInline("$")), caret: true },
      { name: "insert-equation-block", icon: EQUATION_BLOCK_ICON, tip: "Equation block", click: run(insertBlock(EQUATION_BLOCK, EQUATION_CARET)), caret: true },
      { name: "insert-table", icon: TABLE_ICON, tip: "Table", click: run(insertBlock(TABLE_BLOCK, TABLE_CARET)), caret: true },
      { name: "insert-picture", icon: PICTURE_ICON, tip: "Picture", click: run(insertPicture), caret: true },
      { name: "insert-footnote", icon: FOOTNOTE_ICON, tip: "Footnote", click: run(insertFootnote), caret: true },
      { name: "insert-rule", icon: RULE_ICON, tip: "Horizontal rule", click: run(insertBlock(RULE_BLOCK, RULE_CARET)), caret: true },
      // The second row starts under the outline button: everything from here
      // on is a switch over the document as a whole and not an edit of the
      // text, so the break falls where a separator stood and does its work.
      "/",
      // Ctrl+D matches whole words by default; this lights up to match inside
      // words too (score -> also the score in scores).
      {
        name: "mdm-match-substring",
        icon: MULTICURSOR_ICON,
        tip: matchTip(),
        click: function () {
          askSetting("multicursorMatch", matchSubstring ? "word" : "substring");
          if (view) view.focus();
        },
      },
      "|",
      // The page: what it is painted in, what it is set in, how its lines
      // meet the right edge and where its words may divide there, and whether
      // it shows the block at the top that is not prose. Switches over the document as a whole, none of which knows
      // there is music in it.
      // The theme leads them, because the fill colours of the next group are
      // defined per theme and the wider switch should read before the ones
      // that depend on it.
      { name: "mdm-theme", icon: THEME_ICON, tip: "Theme", menu: themeMenuItems() },
      {
        name: "mdm-text-font",
        icon: TEXT_FONT_ICON,
        tip: textFontTip(),
        click: function () {
          askSetting("textFont", textFont === "roman" ? "sans" : "roman");
        },
      },
      // Beside the hyphenation menu, since the two decide together how a
      // line of prose meets the right edge.
      {
        name: "mdm-text-align",
        icon: textAlignIcon(),
        tip: textAlignTip(),
        click: function () {
          askSetting("textAlign", textAlign === "justify" ? "left" : "justify");
        },
      },
      {
        name: "mdm-hyphenation",
        icon: HYPHENATION_ICON,
        tip: "Hyphenation",
        build: hyphenationMenuItems,
      },
      {
        name: "mdm-front-matter",
        icon: FM_ICON,
        tip: fmTip(),
        click: function () {
          if (headerText === "") return;
          askSetting("frontMatter", editorFrontMatter ? "hidden" : "shown");
        },
      },
      "|",
      // The score: the three that dress the music and touch nothing else on
      // the page, in the order a reader meets them, the box, then the lines
      // inside it, then where the box sits.
      { name: "mdm-score-fill", icon: SCORE_ICON, tip: "Score fill", menu: fillMenuItems() },
      {
        name: "mdm-staff-lines",
        icon: STAFF_ICON,
        tip: staffTip(),
        click: function () {
          askSetting("staffLines", staffLines === "gray" ? "ink" : "gray");
        },
      },
      {
        name: "mdm-score-align",
        icon: ALIGN_ICON[alignTarget()],
        tip: alignTip(),
        click: function () {
          askSetting("scoreAlign", alignTarget());
        },
      },
      "|",
      // The playing: alone at the end, because it is the only button here
      // that changes what the editor DOES rather than what anything looks
      // like, and the only one that means nothing until a tune sounds.
      {
        name: "mdm-follow",
        icon: FOLLOW_ICON,
        tip: followTip(),
        click: function () {
          askSetting("followPlayhead", following ? "still" : "follow");
        },
      },
    ];
    specs.forEach(function (spec) {
      if (spec === "|") bar.appendChild(separator());
      else if (spec === "/") bar.appendChild(rowBreak());
      else bar.appendChild(toolbarButton(spec));
    });
    // A press on the chrome must not take the focus off the text. The
    // document draws itself with nobody in it while it is unfocused, so the
    // source of the caret's line went away for as long as a button was held
    // down and came back when it was let go: the owner saw the `##` of a
    // heading go and return around a press on the heading menu (2026-09-19),
    // and it was every button of the bar, not that menu. preventDefault on
    // mousedown keeps the focus where it is; the press still arrives, and
    // the handlers that want the caret back still call view.focus() for a
    // press made while the text did not have it.
    // Buttons only, and not the panels CodeMirror puts inside the view (the
    // search row, whose field is there to be typed in): the player's
    // progress bar is a div that abcjs drags by hand, and preventing its
    // default would be preventing the drag.
    // The rail does it another way, with spans that cannot take the focus at
    // all, because it stands inside the content where a focusable element
    // would take the caret with it (chromeButton).
    document.addEventListener("mousedown", function (e) {
      const el = e.target && e.target.closest ? e.target.closest("button, [role=button]") : null;
      if (el && el.closest(".mdm-toolbar, .mdm-outline") && !el.closest(".cm-panels")) e.preventDefault();
    });
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenus();
      // Ctrl+F with the focus anywhere in the page opens the search panel:
      // the editor's own keymap hears the key only from a caret in the text,
      // and the document opens unfocused (G118).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f" && view && !view.hasFocus) {
        e.preventDefault();
        // The panel is inside the view, so the field it focuses makes the
        // document somebody's, and a match inside a hidden block opens it.
        // Said ahead of the opening: the field is focused inside the update
        // that mounts the panel, where syncFocus cannot dispatch it.
        if (!view.state.field(focusField, false)) view.dispatch({ effects: setFocused.of(true) });
        CM.openSearchPanel(view);
      }
    });
    return bar;
  }

  // Undo and redo grey out when there is nothing to do, the way they did.
  function updateUndoButtons() {
    if (!view) return;
    const undoBtn = document.querySelector('#app button[data-type="undo"]');
    const redoBtn = document.querySelector('#app button[data-type="redo"]');
    if (undoBtn) undoBtn.classList.toggle("mdm-btn--off", CM.undoDepth(view.state) === 0);
    if (redoBtn) redoBtn.classList.toggle("mdm-btn--off", CM.redoDepth(view.state) === 0);
  }

  // ---------- Initialization ----------

  function init(text) {
    const root = app();
    root.innerHTML = "";
    root.appendChild(buildToolbar());
    // The face goes on before the view is built, and not below with the other
    // buttons that come up holding a state: CodeMirror measures a character
    // and a line the moment it is created, and measuring them in the face the
    // document is not going to be set in is a page laid out for the wrong
    // font until something else asks for a measure.
    applyTextFont();
    applyTextAlign();
    applyHyphenation();
    // Below the bar, a row: the outline panel down the left edge and the
    // editor beside it. The panel is empty and hidden until its button is
    // pressed (#app carries mdm-outline--open).
    const body = document.createElement("div");
    body.className = "mdm-body";
    const outline = document.createElement("div");
    outline.className = "mdm-outline";
    const otitle = document.createElement("div");
    otitle.className = "mdm-outline__title";
    otitle.textContent = "Outline";
    const olist = document.createElement("div");
    olist.className = "mdm-outline__list";
    outline.appendChild(otitle);
    outline.appendChild(olist);
    body.appendChild(outline);
    const grip = document.createElement("div");
    grip.className = "mdm-outline__grip";
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-orientation", "vertical");
    grip.setAttribute("aria-label", "Resize the outline");
    body.appendChild(grip);
    makeOutlineGrip(grip, body);
    const host = document.createElement("div");
    host.className = "mdm-editor";
    body.appendChild(host);
    root.appendChild(body);
    buildEditor(text);
    updateFrontMatter();
    updateUndoButtons();
    // The buttons that hold a state come up showing the setting they were left
    // on, the panel included: the document reopens as it was closed.
    applyOutlineWidth();
    applyOutline();
    updateMatchButton();
    updateFollowButton();
    watchOutlineRoom();
    watchTheme();
    applyTheme();
    applyScoreAlign();
    watchScoreSelection();
    watchPlayerKeys();
    watchPlayerWidth();
    watchAltPresses();
    afterRender();
  }

  window.addEventListener("message", function (e) {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === "exportAudio") {
      // The host's side of a run: the answer to a start, the acknowledgement
      // of a file, or the reader cancelling the progress notification. A
      // message for a run that is over is nothing to answer.
      const run = audioRuns.get(msg.id);
      if (!run) return;
      if (msg.cancel) {
        run.cancelled = true;
        // The run may be standing on an answer that is never coming: the host
        // ends a cancelled run and drops what was already on its way, so the
        // wait is ended here rather than left to the minute of AUDIO_ACK_MS.
        const stopped = run.waiting;
        run.waiting = null;
        if (stopped) stopped({ ok: false, cancelled: true });
        return;
      }
      const waiting = run.waiting;
      run.waiting = null;
      if (waiting) waiting(msg);
      return;
    }
    if (msg.type === "settings") {
      const next = msg.settings || {};
      themeSetting = next.theme || "auto";
      scoreFill = next.scoreFill || "none";
      staffLines = next.staffLines || "gray";
      scoreAlign = next.scoreAlign || "center";
      const nextModifier = next.multiCursorModifier || "alt";
      if (nextModifier !== multiCursorModifier) {
        multiCursorModifier = nextModifier;
        if (view) view.dispatch({ effects: gestures.reconfigure(gestureExtensions()) });
      }
      const nextFm = next.frontMatter || "hidden";
      if (nextFm !== frontMatter) {
        // The update that follows this message carries the document in the
        // mode just chosen, and it is dropped while an edit is still
        // debounced. Send that edit now so the toggle is never swallowed by
        // a keystroke made a moment earlier.
        flushEdit();
        // The button adds or removes the header at the very top of the
        // document, and what was pressed is a button about the header, so
        // the update right behind this message takes the editor there. Only
        // where there is a header to move: the hyphenation menu puts a
        // document on the hidden mode as it writes a `lang:` into a file
        // that had none (writeLanguage in extension.js), and nothing about
        // the text moves there, so a reader choosing a language halfway
        // down a document stays where they were reading.
        if (headerText !== "") scrollToTop = true;
      }
      frontMatter = nextFm;
      outlineOpen = next.outline === "shown";
      outlineWidth = next.outlineWidth || 250;
      matchSubstring = next.multicursorMatch === "substring";
      following = next.followPlayhead !== "still";
      textFont = next.textFont || "roman";
      textAlign = next.textAlign || "justify";
      hyphenation = next.hyphenation || "none";
      // applyTheme repaints the toolbar and the score styling, whose colours
      // are picked from the effective theme. A theme chosen from the menu
      // also brings a palette message right behind this one, which repaints
      // again with the colours and the side of the theme that was picked.
      applyTheme();
      applyScoreAlign();
      updateFrontMatter();
      // The width first: the panel is shown by the call after it, and setting
      // its width before that keeps it from opening at one width and jumping
      // to another.
      applyOutlineWidth();
      applyOutline();
      updateMatchButton();
      applyFollowPlayhead();
      applyTextFont();
      applyTextAlign();
      applyHyphenation();
      return;
    }
    if (msg.type === "palette") {
      palette = msg.palette || null;
      themeSide = msg.side || null;
      applyTheme();
      return;
    }
    if (msg.type === "applied") {
      editApplied(msg);
      return;
    }
    if (msg.type === "flush") {
      // The host is about to write the file and asks for what is held back:
      // the edit goes first, the answer after it, on the same ordered wire.
      flushEdit();
      vscode.postMessage({ type: "flushed", id: msg.id });
      return;
    }
    if (msg.type !== "update") return;
    const previousHeader = headerText;
    headerText = msg.frontMatter || "";
    // Adopted even when the text below turns out to be the one already in
    // the editor: for a file with no header both modes produce the same
    // text, and the flag still has to follow the setting. Before the
    // language is read, which takes the header from the text only while the
    // text carries it (documentLanguage).
    editorFrontMatter = !!msg.withFrontMatter;
    if (view && previousHeader !== headerText) applyHyphenation();
    hiddenLines = msg.hiddenLines || 0;
    updateFrontMatter();
    // Before the text, so that one update never draws the new document under
    // the old numbering. The first update has no view yet: the field takes the
    // count from the variable as the state is created.
    if (view && hiddenLines !== view.state.field(hiddenLinesField, false)) {
      view.dispatch({ effects: setHiddenLines.of(hiddenLines) });
    }
    if (!view) {
      if (msg.version !== undefined) base = msg.version;
      init(msg.text);
      return;
    }
    replaceText(msg.text, msg.version, msg.changes);
    if (scrollToTop) {
      scrollToTop = false;
      const s = scroller();
      if (s) s.scrollTop = 0;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
