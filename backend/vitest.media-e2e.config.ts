import { defineConfig } from "vitest/config"
import path from "path"
import mediaE2e from "./src/test/media-e2e-files.json"

/**
 * The real-media end-to-end suite: exactly the files `src/test/media-e2e-files.json`
 * lists, which `vitest.config.ts` (Backend Tests) excludes, so every file runs in
 * one suite or the other (tools/__tests__/media-e2e-ownership.test.mjs).
 *
 * Run by `npm run test:media-e2e`: the Media E2E job in ci.yml, which runs on a
 * PR only when one of its inputs changed (tools/ci/job-inputs.json), on every
 * push and every PR into main, and nightly (nightly-media-e2e.yml). Same
 * environment and setup as Backend Tests; the files set their own timeouts.
 *
 * One file at a time: each saturates the runner's cores on its own (ffmpeg, or
 * the face models), and two at once only stretch every case toward its timeout,
 * which is how these files flaked inside the Backend Tests shards. A
 * VITEST_MAX_WORKERS in the environment overrides `fileParallelism` (the CI
 * pool's image sets it to 2), so both jobs that run this suite set it to 1.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: mediaE2e.files,
    setupFiles: ["./src/test/setup.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
