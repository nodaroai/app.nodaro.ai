// The guard-mode Vitest fixture: the regression cases copy this directory to
// a scratch workspace and apply seeds/*.patch there.
export default { test: { include: ["**/*.cases.mjs"], environment: "node" } }
