// Unit tests for vscode-mdm/theme.js: reading the syntax colours out of the
// VS Code colour theme in use. What matters here is that a theme file (third
// party JSON, comments and all) is turned into a small palette, that only
// plain hex colours get through, since those values end up inside the webview
// HTML, and that anything unreadable yields no palette at all instead of a
// broken one.
// Run with: node --test tests/theme.test.js

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  syntaxPalette,
  listThemes,
  stripJsonComments,
  parseJsonc,
  findTheme,
  loadTheme,
  scopeColor,
  paletteFrom,
  themeKind,
} = require("../vscode-mdm/theme.js");

// A fake file system: path -> contents.
function reader(files) {
  return (file) => {
    if (!(file in files)) throw new Error("ENOENT " + file);
    return files[file];
  };
}

// ---------- JSON with comments ----------

test("comments are cut and the JSON parses", () => {
  const text = '{ // head\n "a": 1, /* mid */ "b": 2 }';
  assert.deepEqual(parseJsonc(text), { a: 1, b: 2 });
});

test("a // inside a string is not a comment", () => {
  const text = '{"url": "https://example.com/x", "b": 2}';
  assert.deepEqual(parseJsonc(text), {
    url: "https://example.com/x",
    b: 2,
  });
  assert.equal(stripJsonComments(text), text);
});

test("an escaped quote does not end the string early", () => {
  const text = '{"a": "say \\"hi\\" // now", "b": 1}';
  assert.deepEqual(parseJsonc(text), { a: 'say "hi" // now', b: 1 });
});

test("a trailing comma is tolerated", () => {
  assert.deepEqual(parseJsonc('{"a": 1, "b": [2, 3,],}'), { a: 1, b: [2, 3] });
});

test("something that is not JSON at all yields null", () => {
  assert.equal(parseJsonc("<plist><dict/></plist>"), null);
});

// ---------- Scope matching ----------

const RULES = [
  { settings: { foreground: "#000001" } }, // no scope: the default foreground
  { scope: "comment", settings: { foreground: "#101010" } },
  { scope: "entity.name", settings: { foreground: "#202020" } },
  { scope: "entity.name.tag", settings: { foreground: "#303030" } },
  { scope: ["string", "constant.numeric"], settings: { foreground: "#404040" } },
  {
    scope: "meta.structure string.quoted",
    settings: { foreground: "#505050" },
  },
];

test("a selector matches the scopes below it", () => {
  assert.equal(scopeColor(RULES, "comment.line.number-sign"), "#101010");
});

test("a selector does not match a longer name that only starts the same", () => {
  assert.equal(scopeColor(RULES, "commentary"), null);
});

test("the most specific selector wins", () => {
  assert.equal(scopeColor(RULES, "entity.name.tag.yaml"), "#303030");
  assert.equal(scopeColor(RULES, "entity.name.function"), "#202020");
});

test("a scope list is read entry by entry", () => {
  assert.equal(scopeColor(RULES, "constant.numeric.integer"), "#404040");
});

test("a comma-separated scope string is split", () => {
  const rules = [{ scope: "keyword, storage", settings: { foreground: "#abcdef" } }];
  assert.equal(scopeColor(rules, "storage.type"), "#abcdef");
});

test("descendant selectors are skipped", () => {
  // Reading it as if it matched would repaint every string in the document
  // from a rule meant for one context.
  assert.equal(scopeColor(RULES, "string.quoted.double"), "#404040");
});

test("later rules win a tie, which is how a theme overrides what it includes", () => {
  const rules = [
    { scope: "string", settings: { foreground: "#111111" } },
    { scope: "string", settings: { foreground: "#222222" } },
  ];
  assert.equal(scopeColor(rules, "string"), "#222222");
});

// ---------- Colour sanitizing ----------

test("only plain hex colours get through", () => {
  const theme = {
    colors: { "editor.foreground": "red", "editor.background": "#123456" },
    tokenColors: [
      { scope: "comment", settings: { foreground: "rgb(1,2,3)" } },
      { scope: "string", settings: { foreground: "#aabbccdd" } },
      { scope: "keyword", settings: { foreground: "</script><script>x" } },
    ],
  };
  const palette = paletteFrom(theme);
  assert.equal(palette.bg, "#123456");
  assert.equal(palette.string, "#aabbccdd");
  assert.equal("base" in palette, false);
  assert.equal("comment" in palette, false);
  assert.equal("keyword" in palette, false);
});

// ---------- include chain ----------

test("an included theme is merged under the one including it", () => {
  const files = {
    "/t/outer.json": JSON.stringify({
      include: "./inner.json",
      type: "dark",
      colors: { "editor.background": "#000000" },
      tokenColors: [{ scope: "string", settings: { foreground: "#222222" } }],
    }),
    "/t/inner.json": JSON.stringify({
      colors: { "editor.background": "#ffffff", "editor.foreground": "#eeeeee" },
      tokenColors: [
        { scope: "string", settings: { foreground: "#111111" } },
        { scope: "comment", settings: { foreground: "#333333" } },
      ],
    }),
  };
  const theme = loadTheme("/t/outer.json", reader(files), 0);
  const palette = paletteFrom(theme);
  assert.equal(palette.bg, "#000000"); // the outer file wins
  assert.equal(palette.base, "#eeeeee"); // only the inner one has it
  assert.equal(palette.string, "#222222"); // outer rule, later in the array
  assert.equal(palette.comment, "#333333"); // inherited
});

test("an include that cannot be read leaves the outer theme usable", () => {
  const files = {
    "/t/outer.json": JSON.stringify({
      include: "./missing.json",
      colors: { "editor.foreground": "#abcabc" },
      tokenColors: [{ scope: "string", settings: { foreground: "#123123" } }],
    }),
  };
  const theme = loadTheme("/t/outer.json", reader(files), 0);
  assert.equal(paletteFrom(theme).base, "#abcabc");
});

// ---------- Finding the theme ----------

const EXT_WITH_ID = {
  extensionPath: "/ext/monokai",
  packageJSON: {
    contributes: {
      themes: [
        {
          id: "Monokai",
          label: "%themeLabel%",
          uiTheme: "vs-dark",
          path: "./themes/monokai.json",
        },
      ],
    },
  },
};

const EXT_WITH_NLS_LABEL = {
  extensionPath: "/ext/other",
  packageJSON: {
    contributes: {
      themes: [
        { label: "%niceLabel%", uiTheme: "vs", path: "./themes/nice.json" },
      ],
    },
  },
};

test("a theme is found by its id", () => {
  const found = findTheme("Monokai", [EXT_WITH_ID], reader({}));
  assert.equal(found.file, "/ext/monokai/themes/monokai.json");
  assert.equal(found.uiTheme, "vs-dark");
});

test("a theme with no id is found by its translated label", () => {
  const files = { "/ext/other/package.nls.json": '{"niceLabel": "Nice Theme"}' };
  const found = findTheme("Nice Theme", [EXT_WITH_NLS_LABEL], reader(files));
  assert.equal(found.file, "/ext/other/themes/nice.json");
});

test("the newer translation format ({message}) is read too", () => {
  const files = {
    "/ext/other/package.nls.json":
      '{"niceLabel": {"message": "Nice Theme", "comment": ["x"]}}',
  };
  const found = findTheme("Nice Theme", [EXT_WITH_NLS_LABEL], reader(files));
  assert.equal(found.file, "/ext/other/themes/nice.json");
});

test("a theme nobody contributes is not found", () => {
  assert.equal(findTheme("Nope", [EXT_WITH_ID], reader({})), null);
});

// ---------- The list behind the toolbar menu ----------

test("every installed theme is listed, with its side, sorted and deduplicated", () => {
  const files = { "/ext/other/package.nls.json": '{"niceLabel": "Nice Theme"}' };
  const twin = {
    extensionPath: "/ext/twin",
    packageJSON: {
      contributes: {
        themes: [
          { id: "Monokai", uiTheme: "vs-dark", path: "./themes/copy.json" },
        ],
      },
    },
  };
  const list = listThemes(
    [EXT_WITH_ID, EXT_WITH_NLS_LABEL, twin],
    reader(files)
  );
  assert.deepEqual(list, [
    { name: "Monokai", kind: "dark" },
    { name: "Nice Theme", kind: "light" },
  ]);
});

test("a contribution with no path is not listed", () => {
  const broken = {
    extensionPath: "/ext/broken",
    packageJSON: { contributes: { themes: [{ id: "Ghost" }] } },
  };
  assert.deepEqual(listThemes([broken], reader({})), []);
});

// ---------- Light or dark ----------

test("the side comes from the theme, and from the contribution when it is silent", () => {
  assert.equal(themeKind({ type: "light" }, "vs-dark"), "light");
  assert.equal(themeKind({}, "vs"), "light");
  assert.equal(themeKind({}, "vs-dark"), "dark");
  assert.equal(themeKind({}, "hc-light"), "light");
});

// ---------- The whole pipeline ----------

const THEME_FILE = JSON.stringify({
  type: "dark",
  colors: { "editor.background": "#272822", "editor.foreground": "#f8f8f2" },
  tokenColors: [
    { scope: "comment", settings: { foreground: "#88846f" } },
    { scope: "string", settings: { foreground: "#e6db74" } },
    { scope: "constant.numeric", settings: { foreground: "#ae81ff" } },
    { scope: "keyword", settings: { foreground: "#f92672" } },
    { scope: "entity.name.tag", settings: { foreground: "#f92672" } },
    { scope: "entity.name.function", settings: { foreground: "#a6e22e" } },
    { scope: "support.type", settings: { foreground: "#66d9ef" } },
  ],
});

test("a theme in use turns into a palette", () => {
  const palette = syntaxPalette({
    name: "Monokai",
    extensions: [EXT_WITH_ID],
    readFile: reader({ "/ext/monokai/themes/monokai.json": THEME_FILE }),
  });
  assert.equal(palette.kind, "dark");
  assert.deepEqual(palette.colors, {
    base: "#f8f8f2",
    bg: "#272822",
    comment: "#88846f",
    string: "#e6db74",
    number: "#ae81ff",
    keyword: "#f92672",
    attr: "#f92672",
    name: "#a6e22e",
    type: "#66d9ef",
  });
});

test("token colour customizations override the theme", () => {
  const palette = syntaxPalette({
    name: "Monokai",
    extensions: [EXT_WITH_ID],
    readFile: reader({ "/ext/monokai/themes/monokai.json": THEME_FILE }),
    customizations: {
      textMateRules: [{ scope: "string", settings: { foreground: "#010203" } }],
      "[Monokai]": {
        textMateRules: [
          { scope: "comment", settings: { foreground: "#040506" } },
        ],
      },
    },
  });
  assert.equal(palette.colors.string, "#010203");
  assert.equal(palette.colors.comment, "#040506");
});

test("no theme name, no theme file, no tokenColors: no palette", () => {
  assert.equal(syntaxPalette({ name: "", extensions: [EXT_WITH_ID] }), null);
  assert.equal(
    syntaxPalette({ name: "Nope", extensions: [EXT_WITH_ID] }),
    null
  );
  assert.equal(
    syntaxPalette({
      name: "Monokai",
      extensions: [EXT_WITH_ID],
      readFile: reader({}),
    }),
    null
  );
  // A theme shipped as a .tmTheme: colours it has, syntax colours it does not.
  assert.equal(
    syntaxPalette({
      name: "Monokai",
      extensions: [EXT_WITH_ID],
      readFile: reader({
        "/ext/monokai/themes/monokai.json": JSON.stringify({
          type: "dark",
          colors: { "editor.background": "#111111" },
          tokenColors: "./monokai.tmTheme",
        }),
      }),
    }),
    null
  );
});

// ---------- The real thing, when VS Code is installed ----------

const BUILT_IN = "/usr/share/code/resources/app/extensions";

test("the built-in Monokai reads as the colours it paints with", (t) => {
  if (!fs.existsSync(BUILT_IN + "/theme-monokai")) {
    t.skip("VS Code is not installed at " + BUILT_IN);
    return;
  }
  const extensions = fs
    .readdirSync(BUILT_IN)
    .filter((name) => name.startsWith("theme-"))
    .map((name) => ({
      extensionPath: BUILT_IN + "/" + name,
      packageJSON: JSON.parse(
        fs.readFileSync(BUILT_IN + "/" + name + "/package.json", "utf8")
      ),
    }));
  const palette = syntaxPalette({ name: "Monokai", extensions });
  assert.equal(palette.kind, "dark");
  assert.equal(palette.colors.bg, "#272822");
  assert.equal(palette.colors.string, "#E6DB74");
  // The YAML key: the VS Code grammar scopes it entity.name.tag.
  assert.equal(palette.colors.attr, "#F92672");
});
