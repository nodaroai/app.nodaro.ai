#!/usr/bin/env node
// tools/units/dump-composed.mjs — `npm run units:baseline`: rewrite the
// composed-registry baselines (tools/units/composed-baseline.mjs) from the
// tree as it is, by running the two baseline tests in write mode. Run it only
// after a DELIBERATE change to a legacy registry, and review the JSON diff:
// it must show exactly that change and nothing else.
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const RUNS = [
  ["frontend", "src/__tests__/units-composed-baseline.test.ts"],
  ["backend", "src/__tests__/units-composed-baseline.test.ts"],
]
let failed = 0
for (const [tree, test] of RUNS) {
  const r = spawnSync("npx", ["vitest", "run", test], { cwd: path.join(ROOT, tree), stdio: "inherit", env: { ...process.env, UNITS_WRITE_BASELINE: "1" } })
  if (r.status !== 0) failed += 1
}
process.exitCode = failed ? 1 : 0
