import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  // Both formats, like @nodaro/shared: the backend loads this at runtime
  // (Node ESM), the editor bundles it (Vite).
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // The EDL contract comes from the app's own @nodaro/shared — never a second
  // bundled copy, so both sides normalize and validate with the same code.
  external: ["@nodaro/shared"],
})
