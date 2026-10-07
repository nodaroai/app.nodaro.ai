/**
 * Builds the real-browser cut-budget page (review-cut.html) in production
 * mode, beside the app's build and never inside it: the app's `vite build`
 * never sees this entry. Same aliases and plugins as the app (mergeConfig).
 */
import path from "path"
import { defineConfig, mergeConfig } from "vite"
import app from "../../vite.config"

export default mergeConfig(
  app,
  defineConfig({
    root: __dirname,
    publicDir: path.resolve(__dirname, "../../public"),
    build: {
      outDir: path.resolve(__dirname, "dist"),
      emptyOutDir: true,
      rollupOptions: { input: path.resolve(__dirname, "review-cut.html") },
    },
  }),
)
