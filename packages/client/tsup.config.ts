import { defineConfig } from "tsup"
import { readFileSync, readdirSync } from "node:fs"

// The client header the backend records as job provenance carries this
// package's version. Injected at BUILD time from package.json so it is
// impossible for the string to drift from the released version — a hardcoded
// constant would silently report a stale one after every release.
const pkgVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string

// The root (`src/index.ts`) plus every subpath entry in `src/entries/` — each
// built to `dist/entries/<name>.{js,cjs,d.ts,d.cts}` and published as
// `@nodaro/sdk/<name>` (package.json "exports", kept in step by
// package-entries.test.ts). `splitting` puts modules shared between entries in
// common chunks for BOTH formats, so the root and a subpath load the same module
// instances (one `NotFoundError` class, so `instanceof` holds across them).
// `supabase-browser` and `signup-signals` are the two older standalone subpaths
// (`@nodaro/sdk/supabase`, `@nodaro/sdk/signup-signals`): not part of the root,
// built where they always were.
const entries = readdirSync("src/entries")
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3))

export default defineConfig({
  entry: {
    index: "src/index.ts",
    ...Object.fromEntries(entries.map((name) => [`entries/${name}`, `src/entries/${name}.ts`])),
    "supabase-browser": "src/supabase-browser.ts",
    "signup-signals": "src/signup-signals.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  metafile: true,
  splitting: true,
  treeshake: true,
  define: { __SDK_VERSION__: JSON.stringify(pkgVersion) },
  external: ["@nodaro/shared", "@supabase/ssr", "@supabase/supabase-js", "@fingerprintjs/fingerprintjs"],
})
