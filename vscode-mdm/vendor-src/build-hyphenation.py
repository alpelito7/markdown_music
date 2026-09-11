"""Vendor hyph-utf8 patterns from a TeX Live texmf-dist directory.

Run: python3 build-hyphenation.py /path/to/texmf-dist
TeX is only a source of data at build time; the editor needs no installation.
"""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
texmf = Path(sys.argv[1])
source = texmf / "tex/generic/hyph-utf8/patterns"
files = {"en": "en-us", "es": "es", "fr": "fr", "de": "de-1996",
         "pt": "pt", "it": "it", "nl": "nl", "pl": "pl", "ru": "ru", "uk": "uk"}
data, notices = {}, []
for lang, name in files.items():
    original = (source / "tex" / f"hyph-{name}.tex").read_text()
    header = original[:original.index("\\patterns")]
    notices.append("Source: https://github.com/hyphenation/tex-hyphen/blob/master/"
                   f"hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-{name}.tex\n" + header)
    exceptions = source / "txt" / f"hyph-{name}.hyp.txt"
    data[lang] = {
        "patterns": " ".join((source / "txt" / f"hyph-{name}.pat.txt").read_text().split()),
        "exceptions": " ".join(exceptions.read_text().split()) if exceptions.exists() else "",
    }

notice = "\n\n".join(notices)
bundle = ("/* Vendored hyph-utf8 patterns, compacted without changing their weights.\n"
          + notice + "\n*/\n(function (root) {\n  const patterns = "
          + json.dumps(data, ensure_ascii=False) + ";\n"
          "  if (typeof module === \"object\" && module.exports) module.exports = patterns;\n"
          "  else root.MDM_HYPHENATION_PATTERNS = patterns;\n"
          "})(typeof globalThis === \"object\" ? globalThis : this);\n")
for directory in ["_extensions/mdm/resources", "vscode-mdm/render/mdm/resources", "vscode-mdm/media"]:
    (root / directory / "hyphenation-patterns.js").write_text(bundle)

# The Russian patterns choose LPPL 1.3c (1.2 or later). Preserve their source
# and licence beside the notices in both distributable extension trees.
for directory in ["_extensions/mdm/resources/hyphenation-licenses", "vscode-mdm/render/mdm/resources/hyphenation-licenses", "vscode-mdm/licenses/hyphenation"]:
    target = root / directory
    target.mkdir(parents=True, exist_ok=True)
    (target / "hyph-ru.tex").write_bytes((source / "tex/hyph-ru.tex").read_bytes())
    (target / "lppl.txt").write_bytes((texmf / "doc/latex/base/lppl.txt").read_bytes())
    (target / "MIT.txt").write_bytes((root / "LICENSE").read_bytes())

print(f"Vendored {len(data)} languages, {len(bundle.encode()):,} bytes per bundle.")
