// Entry of media/vendor/cm6/cm6.bundle.js. Everything the webview needs from
// CodeMirror 6, KaTeX and the MDM Lezer extensions, exposed as window.CM so
// that media/main.js stays a plain script with no build of its own.
export {
  EditorState, EditorSelection, StateField, StateEffect, Facet, Compartment,
  Transaction, Text, Prec, RangeSet, RangeSetBuilder, Annotation,
  CharCategory, findClusterBreak,
} from "@codemirror/state";
export {
  EditorView, Decoration, WidgetType, ViewPlugin, ViewUpdate, keymap,
  drawSelection, rectangularSelection, crosshairCursor, dropCursor,
  highlightActiveLine, highlightSpecialChars, placeholder, runScopeHandlers,
  scrollPastEnd, BlockInfo,
} from "@codemirror/view";
export {
  defaultKeymap, historyKeymap, history, undo, redo, undoDepth, redoDepth,
  indentWithTab, insertNewlineAndIndent, selectLine, cursorLineUp,
  cursorLineDown, deleteCharBackward, deleteCharForward, standardKeymap,
  toggleComment,
} from "@codemirror/commands";
export {
  searchKeymap, selectNextOccurrence, selectSelectionMatches,
  highlightSelectionMatches, search, openSearchPanel, closeSearchPanel,
  SearchCursor,
} from "@codemirror/search";
export {
  syntaxTree, ensureSyntaxTree, syntaxTreeAvailable, HighlightStyle,
  syntaxHighlighting, defaultHighlightStyle, Language, LanguageDescription,
  LanguageSupport, StreamLanguage, indentUnit, foldable, language,
} from "@codemirror/language";
export { tags, styleTags, Tag } from "@lezer/highlight";
export { parseMixed, NodeProp, Tree, TreeCursor } from "@lezer/common";
export {
  markdown, markdownLanguage, markdownKeymap, commonmarkLanguage,
  insertNewlineContinueMarkup, deleteMarkupBackward,
} from "@codemirror/lang-markdown";
export { parser as markdownParser, GFM, Subscript, Superscript, Emoji, Table, TaskList, Strikethrough, Autolink } from "@lezer/markdown";
export { yaml, yamlLanguage } from "@codemirror/lang-yaml";
export { default as katex } from "katex";
export { codeLanguages } from "./languages.js";
export { abc, abcTags } from "./abc.js";
export * from "./markdown/index.js";
