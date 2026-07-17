// Bundles the compiled output into a single minified file for shipping.
//
// This is packaging, not protection. Minified code is trivially reversible and
// anyone who can reach the server can read whatever runs on it — the thing that
// actually keeps the code private is that the box and the repo are private.
// What this does buy: one file instead of a source tree, and nothing that
// resembles editable source in the image.
//
// Deliberately not doing what the old `obfuscate.mjs` did: controlFlowFlattening
// and deadCodeInjection both make the process measurably slower, which is the
// opposite of what this server is for.
import { build } from "esbuild";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, "dist", "index.js");

const result = await build({
  entryPoints: [path.join(root, "build", "index.js")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile,
  minify: true,
  // Native modules cannot be bundled — they are resolved from node_modules at
  // runtime and must stay external.
  external: ["better-sqlite3", "sharp"],
  // Kept out of the image; keep it somewhere you can read, or a production
  // stack trace is unusable.
  sourcemap: "external",
  legalComments: "none",
  banner: {
    // cluster re-executes this file for each worker; esm output has no
    // require(), which better-sqlite3's loader path still expects.
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
  logLevel: "info",
});

if (result.errors.length > 0) process.exit(1);

// dist/ ships; the map does not.
await writeFile(
  path.join(root, "dist", "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n"
);

console.log(`bundled -> ${path.relative(root, outfile)}`);
