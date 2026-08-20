// theme.js: the syntax colours of the VS Code colour theme in use, boiled
// down to the handful of slots the webview paints code with.
//
// A webview receives every colour of VS Code's own registry as a --vscode-*
// variable, but the TextMate token colours, the ones that actually paint code
// in the editor, are not in that registry and no API hands them over. What is
// reachable is the theme itself: workbench.colorTheme names it, one of the
// installed extensions contributes it, and its JSON carries the tokenColors
// array. That file is read here.
//
// Two cases end with no palette at all, and the webview then falls back to the
// two baked into style.css (Monokai for dark, stackoverflow-light for light):
// a theme shipped as a .tmTheme (XML plist, not parsed here), and a theme file
// that cannot be read or parsed.

"use strict";

const fs = require("fs");
const path = require("path");

// Colours reach the webview HTML and its inline styles, and a theme file is
// arbitrary third-party JSON, so only plain hex colours get through.
const COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function color(value) {
  return typeof value === "string" && COLOR.test(value.trim())
    ? value.trim()
    : null;
}

// Theme files are JSON with comments (and the odd trailing comma). Comments
// are cut outside of strings; escapes inside strings are honoured so that a
// "//" or a quote in a value does not end the string early.
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function parseJsonc(text) {
  const stripped = stripJsonComments(text);
  try {
    return JSON.parse(stripped);
  } catch (e) {
    try {
      // Trailing commas, which JSON.parse rejects and theme authors write.
      return JSON.parse(stripped.replace(/,(\s*[}\]])/g, "$1"));
    } catch (e2) {
      return null;
    }
  }
}

// A theme may `include` another one (the built-in Dark Modern is three files
// deep). The included theme goes first, so that what the outer file says wins:
// its colours overwrite, and its rules, being later in the array, outrank the
// ones they repeat.
function loadTheme(file, readFile, depth) {
  if (depth > 10) return null;
  let raw;
  try {
    raw = readFile(file);
  } catch (e) {
    return null;
  }
  const parsed = parseJsonc(raw);
  if (!parsed || typeof parsed !== "object") return null;
  let theme = { type: parsed.type, colors: {}, tokenColors: [] };
  if (typeof parsed.include === "string") {
    const base = loadTheme(
      path.resolve(path.dirname(file), parsed.include),
      readFile,
      depth + 1
    );
    if (base) {
      theme = { type: base.type, colors: base.colors, tokenColors: base.tokenColors };
      if (parsed.type) theme.type = parsed.type;
    }
  }
  if (parsed.colors && typeof parsed.colors === "object") {
    theme.colors = Object.assign({}, theme.colors, parsed.colors);
  }
  // tokenColors as a string is a path to a .tmTheme; not read (see the header).
  if (Array.isArray(parsed.tokenColors)) {
    theme.tokenColors = theme.tokenColors.concat(parsed.tokenColors);
  }
  return theme;
}

// A label of the form %key% is a translated string, looked up in the
// extension's package.nls.json. The built-in themes are all written that way,
// so a theme with no id (the setting then holds its label) would not be found
// by its manifest alone.
function themeLabel(label, extensionPath, readFile) {
  if (typeof label !== "string") return null;
  const key = /^%(.+)%$/.exec(label);
  if (!key) return label;
  try {
    const nls = JSON.parse(readFile(path.join(extensionPath, "package.nls.json")));
    const value = nls[key[1]];
    if (typeof value === "string") return value;
    // The newer format wraps each entry in { message, comment }.
    if (value && typeof value.message === "string") return value.message;
  } catch (e) {
    // No translations to read: the placeholder is all there is.
  }
  return label;
}

// The theme named in workbench.colorTheme, looked up among the contributions
// of every installed extension (the built-in themes are contributed by an
// extension too). The setting holds the theme's id, or its label when it has
// no id.
function findTheme(name, extensions, readFile) {
  const read = readFile || ((file) => fs.readFileSync(file, "utf8"));
  for (const ext of extensions || []) {
    const pkg = (ext && ext.packageJSON) || {};
    const themes = (pkg.contributes && pkg.contributes.themes) || [];
    for (const theme of themes) {
      if (!theme || typeof theme.path !== "string") continue;
      const hit =
        theme.id === name ||
        theme.label === name ||
        (!theme.id && themeLabel(theme.label, ext.extensionPath, read) === name);
      if (!hit) continue;
      return {
        file: path.resolve(ext.extensionPath, theme.path),
        uiTheme: theme.uiTheme,
      };
    }
  }
  return null;
}

// Every colour theme installed in VS Code, as the toolbar menu lists them:
// the name to ask for it back (its id, or its label when it has none) and the
// side it sits on. Deduplicated, since two extensions may contribute a theme
// under the same name, and sorted by name so the menu keeps its order between
// sessions.
function listThemes(extensions, readFile) {
  const read = readFile || ((file) => fs.readFileSync(file, "utf8"));
  const byName = new Map();
  for (const ext of extensions || []) {
    const pkg = (ext && ext.packageJSON) || {};
    const themes = (pkg.contributes && pkg.contributes.themes) || [];
    for (const theme of themes) {
      if (!theme || typeof theme.path !== "string") continue;
      const name =
        theme.id || themeLabel(theme.label, ext.extensionPath, read) || null;
      if (typeof name !== "string" || name === "" || byName.has(name)) continue;
      byName.set(name, { name: name, kind: themeKind(null, theme.uiTheme) });
    }
  }
  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

// TextMate scope selectors: a rule matches a scope when its selector is that
// scope or a prefix of it at a dot boundary, so `entity.name` covers
// `entity.name.tag.yaml`. The most specific selector wins, ties go to the last
// rule, which is how a theme overrides what it includes. Selectors with a
// space in them (descendant or exclusion selectors, `meta.x string`) are
// skipped: whether they apply depends on the surrounding scopes, which are not
// known here, and honouring them blindly repaints far too much.
function matches(selector, scope) {
  return selector === scope || scope.indexOf(selector + ".") === 0;
}

function scopeColor(tokenColors, scope) {
  let best = null;
  let bestSpecificity = -1;
  (tokenColors || []).forEach((rule) => {
    if (!rule || !rule.settings) return;
    const value = color(rule.settings.foreground);
    if (!value) return;
    const selectors =
      typeof rule.scope === "string"
        ? rule.scope.split(",")
        : Array.isArray(rule.scope)
          ? rule.scope
          : [];
    selectors.forEach((raw) => {
      if (typeof raw !== "string") return;
      const selector = raw.trim();
      if (selector === "" || /\s/.test(selector)) return;
      if (!matches(selector, scope)) return;
      const specificity = selector.split(".").length;
      if (specificity >= bestSpecificity) {
        bestSpecificity = specificity;
        best = value;
      }
    });
  });
  return best;
}

// A rule with no scope at all sets the default foreground, the colour of
// everything the theme does not name.
function defaultForeground(tokenColors) {
  let value = null;
  (tokenColors || []).forEach((rule) => {
    if (!rule || !rule.settings || rule.scope !== undefined) return;
    value = color(rule.settings.foreground) || value;
  });
  return value;
}

// The slots style.css paints with, each one asking the theme for the scopes
// that carry it, in order of preference. `attr` is the YAML key: the VS Code
// YAML grammar scopes it entity.name.tag, which is why a header key comes out
// the same colour as an HTML tag in the editor.
const SLOTS = {
  comment: ["comment"],
  string: ["string"],
  number: ["constant.numeric", "constant.language", "constant"],
  keyword: ["keyword", "storage"],
  attr: ["entity.name.tag", "support.type.property-name", "variable"],
  name: ["entity.name.function", "entity.name", "support.function"],
  type: ["support.type", "entity.name.type", "storage.type"],
  variable: ["variable", "variable.other"],
};

function paletteFrom(theme) {
  const colors = theme.colors || {};
  const rules = theme.tokenColors || [];
  const out = {
    base: color(colors["editor.foreground"]) || defaultForeground(rules),
    bg: color(colors["editor.background"]),
  };
  Object.keys(SLOTS).forEach((slot) => {
    let value = null;
    SLOTS[slot].some((scope) => {
      value = scopeColor(rules, scope);
      return !!value;
    });
    if (value) out[slot] = value;
  });
  Object.keys(out).forEach((slot) => {
    if (!out[slot]) delete out[slot];
  });
  return out;
}

// Light or dark, as the theme itself declares it. High contrast counts as the
// side it sits on, which is what the webview compares against its own theme.
function themeKind(theme, uiTheme) {
  const type = (theme && theme.type) || uiTheme;
  if (type === "light" || type === "vs" || type === "hcLight" || type === "hc-light") {
    return "light";
  }
  return "dark";
}

// Rules from editor.tokenColorCustomizations, both the plain ones and those
// under a [Theme Name] block, appended after the theme's own so they win.
function customRules(customizations, themeName) {
  if (!customizations || typeof customizations !== "object") return [];
  const scoped = customizations["[" + themeName + "]"];
  const rules = [];
  if (Array.isArray(customizations.textMateRules)) {
    rules.push.apply(rules, customizations.textMateRules);
  }
  if (scoped && Array.isArray(scoped.textMateRules)) {
    rules.push.apply(rules, scoped.textMateRules);
  }
  return rules;
}

// The whole pipeline, on plain data so it can be tested without VS Code:
// name of the theme in use, the installed extensions, a way to read a file.
// Returns null when there is nothing usable, and the webview then falls back
// to its own palettes.
function syntaxPalette(options) {
  const opts = options || {};
  const name = opts.name;
  if (typeof name !== "string" || name === "") return null;
  const readFile = opts.readFile || ((file) => fs.readFileSync(file, "utf8"));
  const found = findTheme(name, opts.extensions, readFile);
  if (!found) return null;
  const theme = loadTheme(found.file, readFile, 0);
  if (!theme) return null;
  theme.tokenColors = (theme.tokenColors || []).concat(
    customRules(opts.customizations, name)
  );
  const colors = paletteFrom(theme);
  if (!colors.base && !colors.string) return null; // nothing worth sending
  return { kind: themeKind(theme, found.uiTheme), colors: colors };
}

module.exports = {
  syntaxPalette,
  listThemes,
  // Exported for the tests.
  stripJsonComments,
  parseJsonc,
  findTheme,
  loadTheme,
  scopeColor,
  paletteFrom,
  themeKind,
};
