import { defineConfig } from "tsup"

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Peer deps + react runtime stay external — the consuming app provides them.
  // Data packages are peers by design: the package renders whatever catalog
  // data the app's own @nodaro/prompts + @nodaro/shared versions carry.
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@nodaro/prompts",
    "@nodaro/shared",
  ],
  // Imported .css files bundle into dist/index.css — consumers import
  // "@nodaro/picker-ui/styles.css" once. injectStyle stays off so CSS
  // loading is explicit and SSR-safe.
  injectStyle: false,
})
