// tools/test-select/global-triggers.mjs
// The files whose change can affect ANY test, in a leaf module (decided
// 2026-10-20): the CI Diff Gate's job gate (tools/ci/job-gate.mjs) runs on a
// sparse checkout and must load this list without the rest of the engine.
// select.mjs re-exports it; this is its one definition.
import { matchesAny } from "./glob.mjs"

// Changing any of these can change the outcome of ANY test — through
// dependencies, configuration, the shared setup, or this engine itself.
export const GLOBAL_TRIGGERS = [
  "package.json", "**/package.json", "package-lock.json",
  "**/vitest.config.*", "**/vitest.*.config.*", "**/vite.config.*", "**/tsconfig*.json",
  "frontend/src/test/**", "backend/src/test/**",
  ".github/workflows/ci.yml", ".github/actions/**",
  // this engine: its code, the script that runs every suite, and the data its
  // code reads (decided 2026-10-18 — not its README, its type declarations or
  // the burn-down lists only the tools/__tests__ guards read;
  // test-select-triggers.test.mjs classifies every file here)
  "tools/test-select/**/*.{mjs,js,ts}", "tools/test-select/run-suite.sh", "tools/test-select/declared-test-data.json",
  // the registry rule's side-effect check (G7's predicate, registry.mjs (d)),
  // and the composer list graph.mjs reads for it
  "tools/units/structure.mjs", "tools/units/registry-composers.json",
  // pin the ffmpeg binary the backend's real-ffmpeg e2e tests run against
  "Dockerfile", "tools/install-pinned-ffmpeg.sh",
]
// A vitest/vite config under tools/__tests__/fixtures/ is a fixture that a
// tool's own node tests load (the test-dedup harness), never the config of a
// suite (decided 2026-10-18). It is judged like any other file: the tests
// that import or watch it are selected. Only there: a config anywhere else,
// even inside a test directory, stays a trigger.
const FIXTURE_CONFIGS = ["tools/__tests__/fixtures/**/{vitest.config.*,vitest.*.config.*,vite.config.*}"]
export function isGlobalTrigger(path) {
  return matchesAny(path, GLOBAL_TRIGGERS) && !matchesAny(path, FIXTURE_CONFIGS)
}
// The GitHub files API stops at 3000 entries; past this we cannot see the diff.
export const MAX_VISIBLE_CHANGES = 2900
