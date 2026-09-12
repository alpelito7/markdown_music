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

  let textFont = SETTINGS.textFont || "roman";

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
    updateTextFontButton();
    remeasureText();
    if (textFont !== "roman" || !document.fonts || !document.fonts.load) return;
    Promise.all(
      ROMAN_FACES.map(function (face) {
        return document.fonts.load(face);
      })
    ).then(remeasureText, remeasureText);
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
      "mdm-btn--on",
      frontMatter === "shown" && headerText !== ""
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

  function editorText() {
    return view ? view.state.doc.toString() : "";
  }

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
    if (!pending || !view) return;
    clearTimeout(pending);
    pending = null;
    sendEdit(editorText());
  }
  window.addEventListener("blur", flushEdit);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushEdit();
  });

  // An incoming text replaces only the stretch that differs: the common head
  // and tail are left alone, so the carets, the undo history and the rendered
  // widgets outside the change all survive an external edit (the text editor
  // open beside this one, a formatter, the header button).
  function replaceText(incoming) {
    // The text of this editor is LF (the host sends it that way, see
    // transforms.js). A CR that got through would not survive the dispatch
    // either: CodeMirror splits an inserted string on /\r\n?|\n/, so the lone
    // CR left at the end of the replacement below would come out as one more
    // line break, and the document would gain a blank line per update.
    const next = incoming.replace(/\r\n?/g, "\n");
    const current = editorText();
    if (next === current) return;
    let head = 0;
    const max = Math.min(current.length, next.length);
    while (head < max && current.charCodeAt(head) === next.charCodeAt(head)) head++;
    let tail = 0;
    while (
      tail < max - head &&
      current.charCodeAt(current.length - 1 - tail) ===
        next.charCodeAt(next.length - 1 - tail)
    ) {
      tail++;
    }
    applying = true;
    try {
      view.dispatch({
        changes: {
          from: head,
          to: current.length - tail,
          insert: next.slice(head, next.length - tail),
        },
        annotations: CM.Transaction.remote.of(true),
      });
    } finally {
      applying = false;
    }
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

  // The copy button in the corner of a code block or a score (widget chrome,
  // see handleChromeClick): the source goes to the clipboard through the
  // clipboard API, nothing is selected, and the block that was copied gives a
  // brief pulse of its own background as the feedback.
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

  // Each score gets a small button beside the copy button that opens a player
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
  // in the corner of a block are the only other way, and a block can be a
  // page long or scrolled clean off the screen, so closing what you are
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
  // What is left behind on the block is the only thing that says which score
  // is sounding: data-mdm-audio, which lights the disc under its headphones
  // (style.css) and keeps the chrome showing without a hover.
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
    block.setAttribute("data-mdm-audio", "1"); // keeps the toggle shown
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
  // not rebuild the widget (ScoreWidget compares by source), so a player
  // plays on while its source is open beside it.
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

  // Rendered HTML per source, kept for the session: the same equation is
  // asked for on every rebuild and the render is the costly step. `error` is
  // the message KaTeX gave, when it refused the source.
  const KATEX_CACHE = new Map();

  function renderTex(tex, display) {
    const key = (display ? "D" : "I") + tex;
    let hit = KATEX_CACHE.get(key);
    if (hit) return hit;
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
    return hit;
  }

  // A rendered equation. Inline ones replace their source; a display one is a
  // block widget that sits under the source lines, which are hidden while no
  // caret is in them (the live preview of the block that is being edited).
  class MathWidget extends WidgetType {
    constructor(tex, display, block, preview) {
      super();
      this.tex = tex;
      this.display = display;
      this.block = block; // block widget (after the source) or inline replace
      // The live render an inline equation shows beside its source while it is
      // being edited: not a replacement, an extra drawing after the closing $.
      this.preview = !!preview;
    }
    eq(other) {
      return (
        other.tex === this.tex &&
        other.display === this.display &&
        other.block === this.block &&
        other.preview === this.preview
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
      } else {
        // Only a block in the middle of an edit gets here (an inline or an
        // untouched block that does not compile keeps its source instead):
        // the message tells what is still missing.
        el.className += " mdm-math--error";
        el.textContent = out.error;
      }
    }
    toDOM() {
      const el = document.createElement(this.block ? "div" : "span");
      this.paint(el);
      return el;
    }
    // The preview is rebuilt on every keystroke as the source changes; painting
    // in place instead of from scratch keeps the same element, so its entrance
    // animation plays once when it appears, not on every character typed. The
    // class is set from scratch each time because CodeMirror may hand this the
    // element of the plain (non-preview) widget it is replacing.
    updateDOM(dom) {
      if (!this.preview) return false;
      this.paint(dom);
      return true;
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
  // in them. It compares equal while the source is the same, so CodeMirror
  // keeps its DOM across carets going in and out of the block, and with it
  // the player that may be sounding.
  class ScoreWidget extends WidgetType {
    constructor(source) {
      super();
      this.source = source;
    }
    eq(other) {
      return other.source === this.source;
    }
    toDOM() {
      const block = document.createElement("div");
      block.className = "mdm-score";
      block.setAttribute("data-mdm-source", this.source);
      const chrome = document.createElement("div");
      chrome.className = "mdm-chrome";
      chrome.appendChild(chromeButton("mdm-copy", "Copy", COPY_ICON, "w"));
      chrome.appendChild(chromeButton("mdm-audio-toggle", "Show player", HEADPHONES_ICON, "w"));
      block.appendChild(chrome);
      const code = document.createElement("code");
      code.className = "language-abc";
      block.appendChild(code);
      renderScore(code, this.source);
      return block;
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

  // The corner of a code block: the language, and the copy button. An inline
  // widget of no size at the start of the first line of code, whose buttons
  // are positioned against that line, so they overlay the card's top right
  // corner.
  class CodeChromeWidget extends WidgetType {
    eq() {
      return true; // one of these is like another: a copy button and nothing else
    }
    toDOM() {
      const el = document.createElement("span");
      el.className = "mdm-chrome mdm-chrome--code";
      el.appendChild(chromeButton("mdm-copy", "Copy", COPY_ICON, "w"));
      return el;
    }
    ignoreEvent() {
      return true;
    }
  }

  function chromeButton(cls, label, icon, tipSide) {
    const btn = document.createElement("span");
    btn.setAttribute("role", "button");
    btn.className = cls + " mdm-tip mdm-tip--" + tipSide;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = icon;
    return btn;
  }

  // Two sheets of paper, the copy glyph of every editor, fill only.
  const COPY_ICON =
    '<svg viewBox="0 0 16 16"><path d="M5.5 2A1.5 1.5 0 0 0 4 3.5v7A1.5 1.5 0 0 0 5.5 12h6a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 11.5 2Zm0 1.2h6q.3 0 .3.3v7q0 .3-.3.3h-6q-.3 0-.3-.3v-7q0-.3.3-.3ZM2.6 5.2v7.3q0 1.5 1.5 1.5h5.6v-1.2H4.1q-.3 0-.3-.3V5.2Z"/></svg>';

  // ---- Small inline widgets ----

  class BulletWidget extends WidgetType {
    eq() {
      return true;
    }
    toDOM() {
      const el = document.createElement("span");
      el.className = "mdm-bullet";
      el.textContent = "•";
      return el;
    }
    ignoreEvent() {
      return false;
    }
  }
  const BULLET = new BulletWidget();

  class CheckboxWidget extends WidgetType {
    constructor(checked) {
      super();
      this.checked = checked;
    }
    eq(other) {
      return other.checked === this.checked;
    }
    toDOM() {
      const el = document.createElement("input");
      el.type = "checkbox";
      el.className = "mdm-task";
      el.checked = this.checked;
      el.setAttribute("aria-label", this.checked ? "Done" : "To do");
      return el;
    }
    // The click is answered in the editor's own mousedown handler, which
    // flips the text; CodeMirror must not move the caret for it.
    ignoreEvent() {
      return true;
    }
  }

  class RuleWidget extends WidgetType {
    eq() {
      return true;
    }
    toDOM() {
      const el = document.createElement("div");
      el.className = "mdm-hr";
      return el;
    }
    ignoreEvent() {
      return false;
    }
  }
  const RULE = new RuleWidget();

  class ImageWidget extends WidgetType {
    constructor(src, alt) {
      super();
      this.src = src;
      this.alt = alt;
    }
    eq(other) {
      return other.src === this.src && other.alt === this.alt;
    }
    toDOM() {
      const img = document.createElement("img");
      img.className = "mdm-image";
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
    if (/^(https?:|data:|vscode-)/i.test(src)) return src;
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
  // read, so `[text](url "title")` draws as its text alone.
  const LINK_SKIP = /^(URL|LinkTitle)$/;

  // The inline content of a cell, read off the syntax tree once and kept as
  // plain data: the widget is built while the tree is at hand and drawn
  // later, when it is not. `skip` names the children that carry no text of
  // their own (the URL of a link, its title).
  function cellParts(node, text, skip) {
    const parts = [];
    const push = function (s) {
      if (s) parts.push({ kind: "text", text: s });
    };
    let at = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      push(text(at, child.from));
      at = child.to;
      const name = child.name;
      if (/Mark$/.test(name) || (skip && skip.test(name))) continue;
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
      } else if (name === "Image") {
        const url = child.getChild("URL");
        const marks = child.getChildren("LinkMark");
        parts.push({
          kind: "image",
          src: url ? imageSource(text(url.from, url.to)) : null,
          alt: marks.length > 1 ? text(marks[0].to, marks[1].from) : "",
        });
      } else if (name === "Link" || name === "Autolink" || name === "URL") {
        const url = child.getChild("URL");
        const inner = cellParts(child, text, LINK_SKIP);
        parts.push({
          kind: "link",
          href: url ? text(url.from, url.to) : partsText(inner),
          parts: inner,
        });
      } else if (CELL_TAGS[name]) {
        parts.push({ kind: "mark", tag: CELL_TAGS[name], parts: cellParts(child, text, skip) });
      } else {
        push(text(child.from, child.to));
      }
    }
    push(text(at, node.to));
    return parts;
  }

  // What a run of parts says, for the title of a link that carries its own
  // address as its label.
  function partsText(parts) {
    return parts
      .map(function (p) {
        return p.kind === "text" ? p.text : p.parts ? partsText(p.parts) : "";
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
        if (p.href) link.title = p.href;
        paintParts(link, p.parts);
        el.appendChild(link);
        return;
      }
      const mark = document.createElement(p.tag);
      if (p.tag === "code") mark.className = "mdm-inline-code";
      paintParts(mark, p.parts);
      el.appendChild(mark);
    });
  }

  // The rows of a pipe table and the alignment of its columns. The alignment
  // row (`| ---: | :--- |`) is the one TableDelimiter that is a child of the
  // table itself; the delimiters inside a row are the pipes between cells.
  function tableModel(node, text) {
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
    // Where each cell starts, counted from the head of the table and not from
    // the head of the document: the drawing outlives the edits made above it
    // (it compares equal while its own source is the same), and an absolute
    // position kept in the DOM would be stale by the time it is clicked. The
    // head of the table is the node's own start, which is what revealBlock
    // counts from when the click comes back.
    const cells = function (row) {
      return row.getChildren("TableCell").map(function (c) {
        return { at: c.from - node.from, parts: cellParts(c, text, null) };
      });
    };
    const head = node.getChild("TableHeader");
    return {
      align: align,
      head: head ? cells(head) : [],
      body: node.getChildren("TableRow").map(cells),
    };
  }

  // A drawn table, a block widget under the source lines, which are hidden
  // while no caret is in them. Equal while the source is the same, so the
  // element survives carets going in and out of the document around it.
  class TableWidget extends WidgetType {
    constructor(source, model) {
      super();
      this.source = source;
      this.model = model;
    }
    eq(other) {
      return other.source === this.source;
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
      return wrap;
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
    return {
      // Whether a line has been given no class at all, which is what says it
      // is prose: every block of the document (a fence, the front matter, a
      // table, a quote) classes the lines it covers.
      bare: function (n) {
        return !lines.has(n);
      },
      add: function (from, to, cls) {
        const first = doc.lineAt(from).number;
        const last = doc.lineAt(Math.max(from, to)).number;
        for (let n = first; n <= last; n++) {
          let set = lines.get(n);
          if (!set) lines.set(n, (set = new Set()));
          cls.split(" ").forEach(function (c) {
            if (c) set.add(c);
          });
        }
      },
      decorations: function () {
        const out = [];
        lines.forEach(function (set, n) {
          out.push(
            Decoration.line({ class: Array.from(set).join(" ") }).range(
              doc.line(n).from
            )
          );
        });
        return out;
      },
    };
  }

  // Which fence info strings are scores: ```abc and Pandoc's ```{.abc .play}.
  function isAbcInfo(info) {
    return /^(abc\b|\{\s*\.abc\b)/.test(info.trim());
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

  function buildDecorations(state) {
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
    const text = function (from, to) {
      return doc.sliceString(from, to);
    };
    const hide = function (from, to) {
      if (to > from) decos.push(Decoration.replace({}).range(from, to));
    };
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
    // are written.
    const markWithSpace = function (node) {
      const to = node.to < doc.length && text(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
      return { from: node.from, to: to };
    };

    tree.iterate({
      enter: function (n) {
        const name = n.name;
        const node = n.node;

        if (name === "FrontMatter") {
          lines.add(n.from, n.to, "mdm-fm-line");
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
          const body = node.getChild("CodeText");
          const infoText = info ? text(info.from, info.to) : "";
          const source = body ? text(body.from, body.to) : "";
          const openLine = doc.lineAt(n.from);
          const closeLine = marks.length > 1 ? doc.lineAt(marks[1].from) : null;
          const blockFrom = openLine.from;
          const blockTo = closeLine ? closeLine.to : doc.lineAt(n.to).to;
          const open = touched(blockFrom, blockTo);
          if (open) delim(node, "CodeMark");
          if (isAbcInfo(infoText)) {
            decos.push(
              Decoration.widget({
                widget: new ScoreWidget(source),
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
          // The chrome rides the first line of the code as an inline widget of
          // no size (a block widget at the fence would go with the fence when
          // that line is hidden).
          decos.push(
            Decoration.widget({
              widget: new CodeChromeWidget(),
              side: -1,
            }).range(body ? body.from : openLine.to)
          );
          lines.add(blockFrom, blockTo, "mdm-code-line");
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
          } else {
            hideLines(openLine.from, openLine.to);
            if (closeLine) hideLines(closeLine.from, closeLine.to);
            if (body) {
              lines.add(body.from, body.from, "mdm-code-first");
              lines.add(body.to, body.to, "mdm-code-last");
            }
          }
          return false;
        }

        if (name === "CodeBlock") {
          // Indented code: no fences to hide, the card alone.
          lines.add(n.from, n.to, "mdm-code-line");
          lines.add(n.from, n.from, "mdm-code-first");
          lines.add(n.to, n.to, "mdm-code-last");
          return false;
        }

        if (name === "BlockMath") {
          const content = node.getChild("BlockMathContent");
          const tex = content ? text(content.from, content.to) : "";
          const blockFrom = doc.lineAt(n.from).from;
          const blockTo = doc.lineAt(n.to).to;
          const out = renderTex(tex, true);
          const open = touched(blockFrom, blockTo);
          if (open || out.html) {
            decos.push(
              Decoration.widget({
                widget: new MathWidget(tex, true, true),
                block: true,
                side: 1,
              }).range(blockTo)
            );
          }
          if (!open && out.html) {
            hideBlock(blockFrom, blockTo);
            return false;
          }
          delim(node, "BlockMathMark");
          lines.add(blockFrom, blockTo, "mdm-math-line mdm-src-line" + (out.html ? "" : " mdm-math--broken"));
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
          const kind = marks.length ? CM.calloutKind(text(marks[0].from, marks[0].to)) || "note" : "note";
          lines.add(n.from, n.to, "mdm-co-line mdm-co--" + kind);
          lines.add(n.from, n.from, "mdm-co-first");
          lines.add(n.to, n.to, "mdm-co-last");
          marks.forEach(function (m) {
            const line = doc.lineAt(m.from);
            if (!touched(line.from, line.to)) lines.add(m.from, m.from, "mdm-co-fence");
          });
          return true;
        }

        if (/^ATXHeading[1-6]$/.test(name)) {
          const level = name.slice(-1);
          lines.add(n.from, n.to, "mdm-h mdm-h" + level);
          if (!touched(n.from, n.to)) {
            node.getChildren("HeaderMark").forEach(function (m) {
              const r = markWithSpace(m);
              // A closing run of #: the space before it goes too.
              const from = m.from > n.from && text(m.from - 1, m.from) === " " ? m.from - 1 : r.from;
              hide(from, r.to);
            });
          }
          return true;
        }

        if (/^SetextHeading[12]$/.test(name)) {
          const level = name.slice(-1);
          const mark = node.getChild("HeaderMark");
          lines.add(n.from, mark ? mark.from - 1 : n.to, "mdm-h mdm-h" + level);
          if (mark) {
            if (!touched(n.from, n.to)) hideLines(mark.from, mark.to);
            else lines.add(mark.from, mark.to, "mdm-mark-line");
          }
          return true;
        }

        if (name === "Blockquote") {
          lines.add(n.from, n.to, "mdm-quote");
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
          lines.add(n.from, n.to, "mdm-li");
          const mark = node.getChild("ListMark");
          if (mark) {
            const line = doc.lineAt(mark.from);
            const bullet = /^[-*+]$/.test(text(mark.from, mark.to));
            if (bullet && !touched(line.from, line.to)) {
              decos.push(Decoration.replace({ widget: BULLET }).range(mark.from, mark.to));
            }
            const task = node.getChild("Task");
            const marker = task && task.getChild("TaskMarker");
            if (marker && !touched(line.from, line.to)) {
              const checked = /x/i.test(text(marker.from, marker.to));
              decos.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(marker.from, marker.to));
            }
          }
          return true;
        }

        if (name === "HorizontalRule") {
          const line = doc.lineAt(n.from);
          if (!touched(line.from, line.to)) {
            decos.push(Decoration.replace({ widget: RULE, block: true }).range(line.from, line.to));
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
              widget: new TableWidget(text(blockFrom, blockTo), tableModel(node, text)),
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

        if (name === "HTMLBlock" || name === "CommentBlock") {
          lines.add(n.from, n.to, "mdm-html-line");
          return false;
        }

        if (name === "Link") {
          const url = node.getChild("URL");
          decos.push(
            Decoration.mark({
              class: "mdm-link",
              attributes: url ? { title: text(url.from, url.to) } : undefined,
            }).range(n.from, n.to)
          );
          if (!touched(n.from, n.to)) {
            node.getChildren("LinkMark").forEach(function (m) {
              hide(m.from, m.to);
            });
            if (url) hide(url.from, url.to);
            const title = node.getChild("LinkTitle");
            if (title) hide(title.from - 1, title.to);
          }
          return true;
        }

        if (name === "Autolink" || name === "URL") {
          decos.push(Decoration.mark({ class: "mdm-link" }).range(n.from, n.to));
          if (name === "Autolink" && !touched(n.from, n.to)) {
            node.getChildren("LinkMark").forEach(function (m) {
              hide(m.from, m.to);
            });
          }
          return false;
        }

        if (name === "Image") {
          const url = node.getChild("URL");
          const src = url ? imageSource(text(url.from, url.to)) : null;
          if (src && !touched(n.from, n.to)) {
            const marks = node.getChildren("LinkMark");
            const alt = marks.length > 1 ? text(marks[0].to, marks[1].from) : "";
            decos.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(n.from, n.to));
            return false;
          }
          return true;
        }

        const marks = INLINE_MARKS[name];
        if (marks) {
          if (name === "InlineCode") {
            decos.push(Decoration.mark({ class: "mdm-inline-code" }).range(n.from, n.to));
            if (touched(n.from, n.to)) delim(node, "CodeMark");
          }
          if (!touched(n.from, n.to)) {
            marks.forEach(function (kind) {
              node.getChildren(kind).forEach(function (m) {
                hide(m.from, m.to);
              });
            });
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
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      if (lines.bare(n) && /^\s*$/.test(line.text)) {
        lines.add(line.from, line.from, "mdm-blank");
      }
      decos.push(lineNumber(n + hidden).range(line.from));
    }

    return Decoration.set(decos.concat(lines.decorations()), true);
  }

  // The tree is built in the background for a long document; when a later
  // piece of it lands, the language plugin dispatches a transaction, and the
  // field sees a different tree and rebuilds.
  const renderField = StateField.define({
    create: buildDecorations,
    update: function (value, tr) {
      if (
        tr.docChanged ||
        tr.selection ||
        tr.state.field(focusField) !== tr.startState.field(focusField) ||
        tr.state.field(hiddenLinesField) !== tr.startState.field(hiddenLinesField) ||
        CM.syntaxTree(tr.state) !== CM.syntaxTree(tr.startState)
      ) {
        return buildDecorations(tr.state);
      }
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
  const HYPHEN_SKIP = /^(?:InlineCode|InlineMath|InlineBlockMath|Image|Autolink|URL|LinkTitle|HTMLTag|Comment|Escape|Entity)$/;
  const HYPHEN_BLOCK_SKIP = /^(?:FrontMatter|FencedCode|CodeBlock|BlockMath|Table|HTMLBlock|CommentBlock)$/;

  function buildHyphens(state) {
    if (hyphenation !== "auto") return Decoration.none;
    const tree = CM.syntaxTree(state), doc = state.doc, decos = [];
    const lang = documentLanguage(state);
    function prose(from, to) {
      window.MDM_HYPHENATION.segments(doc.sliceString(from, to), lang).forEach(function (span) {
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

  // Wrap each range in a pair of marks, or unwrap it if it is already wrapped
  // (bold, italic, inline code). A collapsed caret gets the pair around it and
  // lands in the middle.
  function toggleInline(mark) {
    return function (v) {
      const len = mark.length;
      v.dispatch(
        v.state.changeByRange(function (range) {
          const from = range.from;
          const to = range.to;
          const before = v.state.sliceDoc(Math.max(0, from - len), from);
          const after = v.state.sliceDoc(to, Math.min(v.state.doc.length, to + len));
          if (before === mark && after === mark) {
            return {
              changes: [
                { from: from - len, to: from },
                { from: to, to: to + len },
              ],
              range: CM.EditorSelection.range(from - len, to - len),
            };
          }
          const inner = v.state.sliceDoc(from, to);
          if (inner.startsWith(mark) && inner.endsWith(mark) && inner.length >= 2 * len) {
            return {
              changes: { from: from, to: to, insert: inner.slice(len, inner.length - len) },
              range: CM.EditorSelection.range(from, to - 2 * len),
            };
          }
          return {
            changes: [
              { from: from, insert: mark },
              { from: to, insert: mark },
            ],
            range: CM.EditorSelection.range(from + len, to + len),
          };
        })
      );
      return true;
    };
  }

  // A link around the selection, or an empty one at the caret, with the
  // caret left where the address goes.
  function insertLink(v) {
    v.dispatch(
      v.state.changeByRange(function (range) {
        const label = v.state.sliceDoc(range.from, range.to);
        const insert = "[" + label + "]()";
        return {
          changes: { from: range.from, to: range.to, insert: insert },
          range: CM.EditorSelection.cursor(range.from + insert.length - 1),
        };
      })
    );
    return true;
  }

  // The heading level of each selected line goes up one, and a level-six
  // line goes back to a paragraph; a paragraph becomes a first-level heading.
  function cycleHeading(v) {
    const changes = [];
    const seen = new Set();
    v.state.selection.ranges.forEach(function (range) {
      const first = v.state.doc.lineAt(range.from).number;
      const last = v.state.doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = v.state.doc.line(n);
        const m = /^(#{1,6})\s+/.exec(line.text);
        if (!m) {
          changes.push({ from: line.from, insert: "# " });
        } else if (m[1].length === 6) {
          changes.push({ from: line.from, to: line.from + m[0].length });
        } else {
          changes.push({ from: line.from, insert: "#" });
        }
      }
    });
    if (changes.length) v.dispatch({ changes: changes });
    return true;
  }

  // A list marker in front of each selected line, or off again if every one
  // of them already carries one of that kind.
  function toggleList(ordered) {
    return function (v) {
      const linesSeen = [];
      const seen = new Set();
      v.state.selection.ranges.forEach(function (range) {
        const first = v.state.doc.lineAt(range.from).number;
        const last = v.state.doc.lineAt(range.to).number;
        for (let n = first; n <= last; n++) {
          if (!seen.has(n)) {
            seen.add(n);
            linesSeen.push(v.state.doc.line(n));
          }
        }
      });
      const re = ordered ? /^(\s*)\d+\.\s+/ : /^(\s*)[-*+]\s+/;
      const all = linesSeen.every(function (line) {
        return re.test(line.text);
      });
      const changes = [];
      linesSeen.forEach(function (line, i) {
        const m = re.exec(line.text);
        if (all && m) {
          changes.push({ from: line.from + m[1].length, to: line.from + m[0].length });
        } else if (!m) {
          const indent = /^\s*/.exec(line.text)[0];
          changes.push({
            from: line.from + indent.length,
            insert: ordered ? i + 1 + ". " : "- ",
          });
        }
      });
      if (changes.length) v.dispatch({ changes: changes });
      return true;
    };
  }

  // Ctrl+Enter: out of the block the caret is in (a fence, an equation, a
  // list, a quote, a callout, a heading line), into a fresh paragraph below
  // it. Plain Enter inside a code block is a newline, as in any code editor:
  // the closing fence is a line of text the caret can walk past.
  const LEAVABLE = /^(FencedCode|CodeBlock|BlockMath|Callout|Blockquote|BulletList|OrderedList|Table|ATXHeading[1-6]|SetextHeading[12]|HTMLBlock|FrontMatter)$/;
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
  function stepIntoBlock(dir) {
    return function (v) {
      const sel = v.state.selection;
      if (sel.ranges.length !== 1 || !sel.main.empty) return false;
      const line = v.state.doc.lineAt(sel.main.head);
      const n = line.number + dir;
      if (n < 1 || n > v.state.doc.lines) return false;
      const target = v.state.doc.line(n);
      const block = hiddenBlockAt(v.state, dir > 0 ? target.from : target.to);
      if (!block) return false;
      const col = sel.main.head - line.from;
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

  // Mousedown on the chrome of a block (copy, player toggle) and on a task
  // checkbox. Caught on the content DOM in the capture phase: CodeMirror
  // ignores events inside these widgets (ignoreEvent), but the browser would
  // still move the native selection to the click, which CodeMirror then
  // reads back as a caret landing in the block; preventing the default keeps
  // the caret where it was. The checkbox flips the text it stands for.
  function handleMouseDown(e) {
    if (!e.target.closest) return;
    if (e.target.closest(".mdm-chrome")) {
      e.preventDefault();
      return;
    }
    const box = e.target.closest("input.mdm-task");
    if (!box || !view) return;
    e.preventDefault();
    const pos = view.posAtDOM(box);
    const line = view.state.doc.lineAt(pos);
    const m = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/.exec(line.text);
    if (!m) return;
    const at = line.from + m[1].length + 1;
    view.dispatch({ changes: { from: at, to: at + 1, insert: m[2] === " " ? "x" : " " } });
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

  // Engraves one score into its <code>. abcjs is loaded by the page before
  // this script (vendor/abcjs), so the engraving is synchronous; what needs
  // the block to be on screen (fitScores measures it) runs afterwards, from
  // the observer below.
  //
  // No `format` block, so every word on the staff keeps the size abcjs gives
  // it: a title at 27 px, a part label at 20, the lyric at 17 in bold, chords
  // at 16. They were held instead to a ladder over the prose's x-height for a
  // while, and that was taken back on 2026-09-10. The exported page and the
  // printed one pass no format either, which is what keeps the three surfaces
  // drawing the same sizes.
  function renderScore(code, source) {
    try {
      if (!window.ABCJS) return;
      code.innerHTML = "";
      const visual = ABCJS.renderAbc(code, source, {
        add_classes: true,
        paddingtop: 2,
        paddingbottom: 2,
        paddingleft: 0,
        paddingright: 0,
      })[0];
      if (visual) SCORE_VISUALS.set(code, visual);
      code.style.overflowX = "auto";
    } catch (e) {
      // Score rendering must never break editing.
    }
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
  // The row is looked for under the caret's own foot rather than taken from
  // the selection, so several carets need no bookkeeping and one CodeMirror
  // has not drawn is not there to be found.
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
    const under = document.elementFromPoint(box.left + 1, box.bottom - 2);
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
    }
    layer.querySelectorAll(".cm-cursor").forEach(fitCaret);
    caretWatcher.takeRecords();
  }
  function watchCarets() {
    requestAnimationFrame(fitCarets);
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
  function deadMargin(e) {
    if (e.button !== 0 || !e.target || !e.target.closest || !view) return;
    if (e.target.closest(".cm-content")) return;
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
  // click is answered by whatever it was actually for; the buttons that work
  // on the caret only meet this with a caret inside a block, where they have
  // nothing to say anyway.
  function dismissFromOutside(e) {
    if (e.button !== 0 || !e.target || !e.target.closest || !view) return;
    // The player is not "anywhere but the text": listening to a score while
    // its ABC is open beside it is one gesture, and a press on play, on the
    // progress or on the volume must not shut the source under the reader.
    // Named here because the bar left the text and stopped being covered by
    // the .cm-content test; this listener is in the capture phase, so the bar
    // cannot answer for itself either.
    if (e.target.closest(".cm-content, .mdm-audio")) return;
    dismissOpenBlock();
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
    const copy = e.target.closest(".mdm-copy");
    if (copy) {
      e.preventDefault();
      e.stopPropagation();
      copyBlock(copy);
      return;
    }
    const toggle = e.target.closest(".mdm-audio-toggle");
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const block = toggle.closest(".mdm-score");
      if (!block) return;
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
    const drawing = e.target.closest(".mdm-score, .mdm-math, .mdm-table");
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
      el.classList.contains("mdm-math--block");
    let node = tree.resolveInner(block ? Math.max(0, pos - 1) : pos, block ? -1 : 1);
    while (node && !OPEN_NODES.test(node.name)) node = node.parent;
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

  // The copy button of a code block shows while the pointer is on the block:
  // the chrome is a zero-height row before the first line, so the hover is
  // read off the lines and written onto the chrome as a class.
  let shownChrome = null;
  function handleMouseOver(e) {
    const line = e.target.closest && e.target.closest(".cm-line");
    let chrome = null;
    if (line && line.classList.contains("mdm-code-line")) {
      // Back over the lines of this block (and the hidden fence between
      // them, a div with no class) to the one the chrome rides.
      let el = line;
      while (el) {
        if (el.classList && el.classList.contains("cm-line")) {
          if (!el.classList.contains("mdm-code-line")) break;
          const c = el.querySelector(".mdm-chrome--code");
          if (c) {
            chrome = c;
            break;
          }
        }
        el = el.previousSibling;
      }
    } else if (e.target.closest && e.target.closest(".mdm-chrome--code")) {
      chrome = e.target.closest(".mdm-chrome--code");
    }
    if (chrome === shownChrome) return;
    if (shownChrome) shownChrome.classList.remove("mdm-chrome--show");
    shownChrome = chrome;
    if (chrome) chrome.classList.add("mdm-chrome--show");
  }

  // The source of the block a piece of chrome belongs to: a score carries it
  // on its widget; a code block's chrome sits right before its first line,
  // and the text is read back from the editor at that position.
  function chromeSource(el) {
    const score = el.closest(".mdm-score");
    if (score) return { source: score.getAttribute("data-mdm-source") || "", score: score };
    const chrome = el.closest(".mdm-chrome--code");
    if (!chrome || !view) return null;
    const pos = view.posAtDOM(chrome);
    const tree = CM.syntaxTree(view.state);
    let node = tree.resolveInner(pos, 1);
    while (node && node.name !== "FencedCode") node = node.parent;
    if (!node) return null;
    const body = node.getChild("CodeText");
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
    return { source: body ? view.state.sliceDoc(body.from, body.to) : "", lines: lines };
  }

  const COPIED_MS = 1500;

  function copyBlock(button) {
    const found = chromeSource(button);
    if (!found) return;
    copyPlain(found.score ? stripLayoutDirectives(found.source) : found.source);
    // The answer is the tooltip itself, so it stays up for a beat and then
    // goes, rather than sitting there under a pointer that has not moved
    // until the block loses the hover. A second and a half is long enough to
    // be read without becoming a label of its own; it is what the copy
    // buttons of GitHub and the like hold theirs for.
    button.setAttribute("aria-label", "Copied");
    setTimeout(function () {
      hideTipUntilLeave(button);
      button.setAttribute("aria-label", "Copy");
    }, COPIED_MS);
    if (found.score) {
      pulseBlock(found.score);
    } else if (found.lines) {
      found.lines.forEach(pulseBlock);
    }
  }

  // ---------- The editor ----------

  // Reading the modifier setting once at build time would pin it: the click
  // facet is a Compartment so a change from the host reconfigures it live.
  const gestures = new CM.Compartment();
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

  function buildEditor(text) {
    const mdmKeymap = [
      { key: "Mod-Enter", run: leaveBlock },
      { key: "Mod-b", run: toggleInline("**") },
      { key: "Mod-i", run: toggleInline("*") },
      { key: "Mod-e", run: toggleInline("`") },
      { key: "Mod-k", run: insertLink },
      { key: "ArrowDown", run: stepIntoBlock(1) },
      { key: "ArrowUp", run: stepIntoBlock(-1) },
      { key: "Ctrl-Alt-ArrowDown", mac: "Cmd-Alt-ArrowDown", run: addCaretVertically(1) },
      { key: "Ctrl-Alt-ArrowUp", mac: "Cmd-Alt-ArrowUp", run: addCaretVertically(-1) },
      // Before searchKeymap's own Mod-d, so the substring toggle is honoured.
      { key: "Mod-d", run: selectNextOccurrenceMaybe },
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
        CM.keymap.of(
          mdmKeymap.concat(
            CM.markdownKeymap,
            CM.defaultKeymap,
            CM.historyKeymap,
            CM.searchKeymap,
            [CM.indentWithTab]
          )
        ),
        CM.markdown({
          base: CM.markdownLanguage,
          codeLanguages: CM.codeLanguages,
          extensions: CM.mdmMarkdownExtensions,
        }),
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
            if (!applying) queueEdit(update.state.doc.toString());
            if (player) player.pos = update.changes.mapPos(player.pos, 1);
            // A `lang:` typed into the header on screen lights or darkens
            // the hyphenation button at once, as it moves the cuts.
            updateHyphenationButton();
          }
          if (update.docChanged || update.selectionSet) {
            updateUndoButtons();
            // The outline follows the document and the caret while it is open.
            if (outlineOpen) refreshOutline();
          }
        }),
      ],
    });
    view = new EditorView({
      state: state,
      parent: document.querySelector("#app .mdm-editor"),
    });
    // applyHyphenation ran above with no view to read the header from.
    updateHyphenationButton();
    // For the test harness and for poking at a live editor: the view itself,
    // and the open player, which is the only way in to the synth controller
    // (abcjs keeps it on no element of the bar it builds).
    window.__mdm = {
      view: view,
      CM: CM,
      get player() {
        return player;
      },
    };
    watchContent();
    watchCarets();
    disarmNativeHistory();
    // Not CodeMirror's own focusChangeEffect: it reports the focus of the
    // text alone and it reports it a tick late (its handler defers), so the
    // player bar read as leaving the document and the first click into an
    // unfocused editor drew one frame with nothing open. Both are answered by
    // watching the focus over the whole view, synchronously.
    document.addEventListener(
      "mousedown",
      function () {
        pressedAt = Date.now();
      },
      true
    );
    view.dom.addEventListener("focusin", syncFocus);
    view.dom.addEventListener("focusout", function () {
      // On the way out the focus has not landed yet: activeElement is still
      // the element being left. Ask once it has.
      setTimeout(syncFocus, 0);
    });
    view.contentDOM.addEventListener("mousedown", handleMouseDown, true);
    view.contentDOM.addEventListener("click", handleChromeClick, true);
    view.contentDOM.addEventListener("mouseover", handleMouseOver);
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
  // a chain link, an H with a small 1, a bulleted list, a numbered list.
  const BOLD_ICON =
    '<svg viewBox="0 0 16 16"><path d="M4 2h4.6q1.7 0 2.6.8t.9 2.1q0 .9-.5 1.6t-1.3.9v.1q1.1.2 1.7 1t.6 1.9q0 1.6-1.1 2.6T8.6 14H4Zm2.3 4.9h2q.8 0 1.2-.4t.4-1-.4-1-1.2-.4h-2Zm0 5.1h2.3q.9 0 1.4-.4t.5-1.1-.5-1.1-1.4-.4H6.3Z"/></svg>';
  const ITALIC_ICON =
    '<svg viewBox="0 0 16 16"><path d="M6.5 2h5.5l-.4 1.9H9.8L7.6 12.1h1.8L9 14H3.5l.4-1.9h1.8L7.9 3.9H6.1Z"/></svg>';
  const CODE_ICON =
    '<svg viewBox="0 0 16 16"><path d="M5.2 3.6 6.4 4.8 3.3 8l3.1 3.2-1.2 1.2L.9 8Zm5.6 0L15.1 8l-4.3 4.4-1.2-1.2L12.7 8 9.6 4.8Z"/></svg>';
  const LINK_ICON =
    '<svg viewBox="0 0 16 16"><path d="M6.6 9.4a3 3 0 0 1 0-4.2l2-2a3 3 0 0 1 4.2 4.2l-1 1-1.1-1.1 1-1a1.5 1.5 0 0 0-2.1-2.1l-2 2a1.5 1.5 0 0 0 0 2.1ZM9.4 6.6a3 3 0 0 1 0 4.2l-2 2a3 3 0 0 1-4.2-4.2l1-1 1.1 1.1-1 1a1.5 1.5 0 0 0 2.1 2.1l2-2a1.5 1.5 0 0 0 0-2.1Z"/></svg>';
  const HEADING_ICON =
    '<svg viewBox="0 0 16 16"><path d="M2 2.5h2.1v4.3h4.3V2.5h2.1v11h-2.1V8.8H4.1v4.7H2Z"/><path d="M12.3 8.2h1.3v5.3h-1.3V9.6l-1 .6-.5-1Z"/></svg>';
  const LIST_ICON =
    '<svg viewBox="0 0 16 16"><circle cx="3" cy="4" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="3" cy="12" r="1.3"/><rect x="6" y="3.3" width="8.5" height="1.4" rx=".7"/><rect x="6" y="7.3" width="8.5" height="1.4" rx=".7"/><rect x="6" y="11.3" width="8.5" height="1.4" rx=".7"/></svg>';
  const OLIST_ICON =
    '<svg viewBox="0 0 16 16"><path d="M2.2 2.4h1v3.1h-1V3.4l-.7.4-.4-.8Z"/><path d="M1.3 7.2q.2-.9 1.3-.9.6 0 .9.3t.3.8q0 .5-.5 1l-.9.9h1.5v.8H1.2v-.7l1.5-1.5q.3-.3.3-.5 0-.3-.4-.3-.4 0-.5.4Z"/><path d="M1.2 12.7q.2-.8 1.3-.8.6 0 1 .3t.3.7q0 .5-.5.7.6.2.6.8 0 .5-.4.8t-1 .3q-1.1 0-1.3-.9l.8-.2q.1.4.5.4.4 0 .4-.3t-.5-.3h-.3v-.7h.3q.4 0 .4-.3t-.4-.3q-.3 0-.4.3Z"/><rect x="6" y="3.3" width="8.5" height="1.4" rx=".7"/><rect x="6" y="7.3" width="8.5" height="1.4" rx=".7"/><rect x="6" y="11.3" width="8.5" height="1.4" rx=".7"/></svg>';
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
  // `===` or `---`). Each entry carries the level, the text with its marks
  // stripped, and the position to jump to (the start of the heading line).
  function outlineHeadings(state) {
    const tree = CM.syntaxTree(state);
    const out = [];
    tree.iterate({
      enter: function (node) {
        let level = 0;
        const m = /^ATXHeading([1-6])$/.exec(node.name);
        if (m) level = Number(m[1]);
        else if (node.name === "SetextHeading1") level = 1;
        else if (node.name === "SetextHeading2") level = 2;
        if (!level) return;
        const line = state.doc.lineAt(node.from);
        let text = state.doc
          .sliceString(node.from, Math.min(node.to, line.to))
          .replace(/^#{1,6}\s*/, "")
          .replace(/\s*#+\s*$/, "")
          .trim();
        out.push({ level: level, pos: line.from, text: text || "(untitled)" });
      },
    });
    return out;
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
  function refreshOutline() {
    const list = outlineList();
    if (!list || !outlineOpen || !view) return;
    const heads = outlineHeadings(view.state);
    const caret = view.state.selection.main.head;
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
      row.textContent = h.text;
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
    btn.setAttribute("aria-label", spec.tip);
    btn.innerHTML = spec.icon;
    item.appendChild(btn);
    if (spec.menu || spec.build) {
      const panel = document.createElement("div");
      panel.className = "mdm-menu";
      item.appendChild(panel);
      const fill = function (entries) {
        panel.innerHTML = "";
        (entries || []).forEach(function (entry) {
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
          panel.appendChild(row);
        });
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
      // The export menu next: the one button that leaves the editor. Each
      // entry saves the document first, then runs the same bin/mdm the command
      // line uses (both on the host side).
      {
        name: "mdm-export",
        icon: EXPORT_ICON,
        tip: "Export",
        menu: EXPORT_FORMATS.map(function (format) {
          return {
            name: "mdm-export-" + format.to,
            label: format.label,
            click: function () {
              vscode.postMessage({ type: "export", to: format.to });
            },
          };
        }),
      },
      "|",
      { name: "undo", icon: UNDO_ICON, tip: "Undo", click: run(CM.undo) },
      { name: "redo", icon: REDO_ICON, tip: "Redo", click: run(CM.redo) },
      "|",
      { name: "headings", icon: HEADING_ICON, tip: "Heading", click: run(cycleHeading) },
      { name: "bold", icon: BOLD_ICON, tip: "Bold", click: run(toggleInline("**")) },
      { name: "italic", icon: ITALIC_ICON, tip: "Italic", click: run(toggleInline("*")) },
      { name: "inline-code", icon: CODE_ICON, tip: "Inline code", click: run(toggleInline("`")) },
      { name: "link", icon: LINK_ICON, tip: "Link", click: run(insertLink) },
      "|",
      { name: "list", icon: LIST_ICON, tip: "Bulleted list", click: run(toggleList(false)) },
      { name: "ordered-list", icon: OLIST_ICON, tip: "Numbered list", click: run(toggleList(true)) },
      "|",
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
      // The page: what it is painted in, what it is set in, where its words
      // may divide, and whether it shows the block at the top that is not
      // prose. Switches over the document as a whole, none of which knows
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
          askSetting("frontMatter", frontMatter === "shown" ? "hidden" : "shown");
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
      bar.appendChild(spec === "|" ? separator() : toolbarButton(spec));
    });
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenus();
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
      applyHyphenation();
      return;
    }
    if (msg.type === "palette") {
      palette = msg.palette || null;
      themeSide = msg.side || null;
      applyTheme();
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
      init(msg.text);
      return;
    }
    if (pending) return;
    replaceText(msg.text);
    if (scrollToTop) {
      scrollToTop = false;
      const s = scroller();
      if (s) s.scrollTop = 0;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
