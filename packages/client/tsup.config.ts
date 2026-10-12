import { defineConfig } from "tsup"
import { readFileSync } from "node:fs"

// The client header the backend records as job provenance carries this
// package's version. Injected at BUILD time from package.json so it is
// impossible for the string to drift from the released version — a hardcoded
// constant would silently report a stale one after every release.
const pkgVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string

export default defineConfig({
  entry: ["src/index.ts", "src/supabase-browser.ts", "src/signup-signals.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  define: { __SDK_VERSION__: JSON.stringify(pkgVersion) },
  external: ["@nodaro/shared", "@supabase/ssr", "@supabase/supabase-js", "@fingerprintjs/fingerprintjs"],
})
