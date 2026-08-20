// Builds ../media/vendor/cm6/: the single IIFE bundle (window.CM) plus the
// KaTeX stylesheet and fonts. Run with `npm run vendor`; the output is
// committed, so the editor itself never needs node_modules.
import { build } from "esbuild";
import { mkdirSync, copyFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "media", "vendor", "cm6");
mkdirSync(join(out, "fonts"), { recursive: true });

const result = await build({
  entryPoints: [join(here, "src", "index.js")],
  bundle: true,
  format: "iife",
  globalName: "CM",
  minify: true,
  legalComments: "none",
  outfile: join(out, "cm6.bundle.js"),
  logLevel: "warning",
  metafile: true,
});

const katexDist = join(here, "node_modules", "katex", "dist");
copyFileSync(join(katexDist, "katex.min.css"), join(out, "katex.min.css"));
// woff2 is enough for Chromium; the css lists woff2 first and falls through.
for (const f of readdirSync(join(katexDist, "fonts"))) {
  if (f.endsWith(".woff2")) copyFileSync(join(katexDist, "fonts", f), join(out, "fonts", f));
}

// Version manifest, so the bundle's provenance is readable without npm.
const versions = {};
for (const p of Object.keys(result.metafile.inputs)) {
  const m = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (!m || versions[m[1]]) continue;
  try {
    versions[m[1]] = JSON.parse(
      (await import("node:fs")).readFileSync(join(here, "node_modules", m[1], "package.json"), "utf8")
    ).version;
  } catch (e) { /* nested or virtual */ }
}
writeFileSync(join(out, "VERSIONS.json"), JSON.stringify(versions, null, 2) + "\n");
console.log("cm6.bundle.js", statSync(join(out, "cm6.bundle.js")).size, "bytes;", Object.keys(versions).length, "packages");
