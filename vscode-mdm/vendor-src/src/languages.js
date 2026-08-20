// Languages a fenced code block can be highlighted in. Full Lezer parsers for
// the ones a maths-and-music book is likely to carry, and the lighter stream
// modes for the rest. Matched by the fence info string through
// LanguageDescription.matchLanguageName (name or alias, case-insensitive).
import { LanguageDescription, StreamLanguage } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { r } from "@codemirror/legacy-modes/mode/r";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { octave } from "@codemirror/legacy-modes/mode/octave";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { c, java, csharp } from "@codemirror/legacy-modes/mode/clike";
import { sql } from "@codemirror/legacy-modes/mode/sql";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { diff } from "@codemirror/legacy-modes/mode/diff";

const full = (name, alias, support) =>
  LanguageDescription.of({ name, alias, support });
const stream = (name, alias, mode) =>
  LanguageDescription.of({ name, alias, support: new (support(mode))() });
function support(mode) {
  const lang = StreamLanguage.define(mode);
  return function Support() { return lang; };
}

export const codeLanguages = [
  full("Python", ["py"], python()),
  full("JavaScript", ["js", "node"], javascript()),
  full("TypeScript", ["ts"], javascript({ typescript: true })),
  full("JSX", ["jsx"], javascript({ jsx: true })),
  full("JSON", [], json()),
  full("YAML", ["yml"], yaml()),
  full("HTML", ["htm"], html()),
  full("CSS", [], css()),
  full("C++", ["cpp", "c++", "cc", "cxx", "hpp"], cpp()),
  stream("R", ["rlang"], r),
  stream("Julia", ["jl"], julia),
  stream("Shell", ["sh", "bash", "zsh", "console"], shell),
  stream("LaTeX", ["tex", "latex", "stex"], stex),
  stream("Lua", [], lua),
  stream("Ruby", ["rb"], ruby),
  stream("Octave", ["matlab", "m"], octave),
  stream("Haskell", ["hs"], haskell),
  stream("C", ["h"], c),
  stream("Java", [], java),
  stream("C#", ["cs", "csharp"], csharp),
  stream("SQL", [], sql),
  stream("TOML", [], toml),
  stream("XML", ["svg", "rss"], xml),
  stream("Diff", ["patch"], diff),
];
