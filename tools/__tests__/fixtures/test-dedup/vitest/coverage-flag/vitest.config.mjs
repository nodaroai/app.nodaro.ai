// Like frontend/vitest.config.ts, this config reads its own command line to
// tell its workers that coverage is on (coverage-flag.ts).
export default {
  test: {
    include: ["**/*.flag.mjs"],
    environment: "node",
    env: process.argv.includes("--coverage") ? { TEST_DEDUP_UNDER_COVERAGE: "1" } : {},
  },
}
