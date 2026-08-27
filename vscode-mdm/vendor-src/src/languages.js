// Languages a fenced code block can be highlighted in. Full Lezer parsers for
// the ones a maths-and-music book is likely to carry, and the lighter stream
// modes for the rest. Matched by the fence info string through
// LanguageDescription.matchLanguageName (name or alias, case-insensitive).
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { abc } from "./abc.js";
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
// The markdown code parser reads `support.language.parser`, so a stream mode
// has to travel inside a LanguageSupport; the bare StreamLanguage used to be
// handed over and threw the moment a stream fence was parsed.
const stream = (name, alias, mode) =>
  LanguageDescription.of({ name, alias, support: new LanguageSupport(StreamLanguage.define(mode)) });

export const codeLanguages = [
  // First for the reader, not the matcher: the score fences are the reason
  // this editor exists. The fuzzy match also catches the Quarto info string
  // `{.abc .play}`, the same forms isAbcInfo() accepts in media/main.js.
  stream("ABC", ["mdm-abc"], abc),
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
