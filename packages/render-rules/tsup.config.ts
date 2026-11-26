import { defineConfig } from "tsup"

export default defineConfig({
  // The sampler is its own entry (`@nodaro/render-rules/scene3d-sampler`): the
  // Remotion renderer and the editor's 3D preview load it without the root.
  entry: { index: "src/index.ts", "scene3d-sampler": "src/scene3d-sampler/index.ts" },
  // Both formats, like @nodaro/shared: the backend loads this at runtime
  // (Node ESM), the editor bundles it (Vite).
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  metafile: true,
  splitting: false,
  treeshake: true,
  // The EDL contract comes from the app's own @nodaro/shared — never a second
  // bundled copy, so both sides normalize and validate with the same code.
  external: ["@nodaro/shared"],
})
