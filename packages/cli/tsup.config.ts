import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  external: ["@nodaro/client", "@nodaro/shared"],
  // Shebang so the file is directly executable when npm symlinks it as bin.
  banner: { js: "#!/usr/bin/env node" },
})
