import { defineConfig } from "vitest/config"
import path from "path"

/**
 * OPT-IN config for the ffmpeg output-characterization suite — invoked ONLY
 * by the `characterize:*` npm scripts, never by `npm test`.
 *
 * The separation is deliberate and load-bearing: the default suite runs on
 * bare GitHub runners and developer laptops, whose ffmpeg is NOT the
 * production binary, and rendered-output assertions against the wrong binary
 * fail everywhere except production's image — which teaches everyone to
 * ignore the failures. Hence the `.char.ts` suffix (invisible to the default
 * `src/**\/*.test.ts` glob) plus this dedicated config. Run via
 * `backend/scripts/characterize-in-image.sh` or the `characterize` CI job,
 * both of which use the apt-pinned production ffmpeg on Debian bookworm.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/providers/video/__characterization__/**/*.char.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Real renders: ~50 operations, several ffmpeg passes each. The default
    // 5 s vitest timeout is far too tight; these bounds still catch a hang.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
