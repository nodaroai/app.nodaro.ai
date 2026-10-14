import { readdirSync } from "node:fs"
import { defineConfig } from "tsup"

// The root (`src/index.ts`) plus every subpath entry in `src/entries/` — each
// built to `dist/entries/<name>.{js,cjs,d.ts,d.cts}` and published as
// `@nodaro/shared/<name>` (package.json "exports", kept in step by
// package-entries.test.ts). `splitting` puts modules shared between entries in
// common chunks for BOTH formats, so the root and a subpath load the same module
// instances — one registry, one i18n sidecar table — never a copy each.
const entries = readdirSync("src/entries")
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3))

export default defineConfig({
  entry: {
    index: "src/index.ts",
    ...Object.fromEntries(entries.map((name) => [`entries/${name}`, `src/entries/${name}.ts`])),
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  metafile: true,
  splitting: true,
  treeshake: true,
})
