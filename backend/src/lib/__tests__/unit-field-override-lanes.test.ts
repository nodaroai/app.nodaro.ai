// @test-watches backend/src/**/*.ts
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, it, expect } from "vitest"

/**
 * Where a node unit's app fields (unit.json `appFields`) are held — the lanes, by source, so a new one cannot
 * skip the check (lib/exposed-unit-field-check.ts):
 *  - the ONE merge of a run's overrides into node data, `applyInputOverridesToNodes`, is called from exactly
 *    one product file (the orchestrator: every lane's job and every continuation is processed there), and
 *    holds the declaration right after the outbound-node lock, before it touches a node;
 *  - every route that refuses a locked override up front (`findLockedOverrides`) refuses an app-field value
 *    outside the declaration up front too, so the caller gets a 400 before any row exists.
 */
const SRC = path.resolve(__dirname, "../..")
const files: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") walk(abs)
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) files.push(abs)
  }
}
walk(SRC)
const rel = (abs: string) => path.relative(SRC, abs).split(path.sep).join("/")
const source = new Map(files.map((f) => [rel(f), readFileSync(f, "utf8")]))
const calling = (fn: string) => [...source].filter(([, s]) => new RegExp(`\\b${fn}\\(`).test(s)).map(([f]) => f).sort()

describe("every lane that can set a unit's app field holds its declaration", () => {
  it("the override merge has one product caller, the orchestrator", () => {
    expect(calling("applyInputOverridesToNodes").filter((f) => !/apply-input-overrides\.ts$/.test(f))).toEqual(["workers/orchestrator-worker.ts"])
  })

  it("the merge holds the declaration before it touches a node, right after the outbound-node lock", () => {
    const merge = source.get("workers/apply-input-overrides.ts")!
    const body = merge.slice(merge.indexOf("export function applyInputOverridesToNodes("))
    const lock = body.indexOf("assertNoLockedOverrides(")
    const unit = body.indexOf("assertUnitFieldOverrides(")
    const firstWrite = body.indexOf("node.data = ")
    expect(lock).toBeGreaterThan(-1)
    expect(unit).toBeGreaterThan(lock)
    expect(unit).toBeLessThan(firstWrite)
  })

  it("every route that refuses a locked override up front refuses an app-field value outside its declaration too", () => {
    const routes = calling("findLockedOverrides").filter((f) => f.startsWith("routes/"))
    expect(routes.length).toBeGreaterThanOrEqual(7)
    expect(routes.filter((f) => !/\bfindUnitFieldOverrideRefusals\(/.test(source.get(f)!))).toEqual([])
  })
})
