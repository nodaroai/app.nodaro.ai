// The Vitest project the harness's real-runner regression cases drive
// (tools/__tests__/test-dedup-equivalence-vitest.test.mjs). `.cases.mjs`, so
// no other suite collects these files.
export default { test: { include: ["**/*.cases.mjs"], environment: "node" } }
