// @test-units-by-name looks up only the unit types it mocks into the budgets aggregate (BUDGETED_JOB_NAMES)
// A worker node unit declares its job budget in its own budget.ts; the gen:units
// aggregate (nodes/_generated/budgets.ts, UNIT_BUDGETS) is composed into the one
// registry every reader calls — the video worker's liveness fallback, the
// orchestrator's ceilings, the row sweeps. A unit's BullMQ job name is its type,
// so its key is its type, and a type lives in exactly one place: a unit that
// also has a legacy row fails at load.
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.doUnmock("../../nodes/_generated/budgets.js")
  vi.resetModules()
})

async function registryWith(units: Record<string, (data: unknown) => number | undefined>) {
  vi.resetModules()
  vi.doMock("../../nodes/_generated/budgets.js", () => ({ UNIT_BUDGETS: units }))
  return import("../job-budget.js")
}

describe("a unit's budget.ts in the job-budget registry", () => {
  it("is read by declaredJobBudgetMs under the unit's type, on the payload it is given", async () => {
    const seen: unknown[] = []
    const { declaredJobBudgetMs } = await registryWith({ "unit-x": (data) => { seen.push(data); return 123 } })
    expect(declaredJobBudgetMs("unit-x", { sources: [1] })).toBe(123)
    expect(seen).toEqual([{ sources: [1] }])
  })

  it("is one of the budgeted job names (the row readers' job_type filter), beside every legacy one", async () => {
    const { BUDGETED_JOB_NAMES } = await registryWith({ "unit-x": () => 123 })
    expect(BUDGETED_JOB_NAMES).toContain("unit-x")
    expect(BUDGETED_JOB_NAMES).toContain("apply-edl")
  })

  it("keeps the registry's guards: a malformed or throwing unit budget reads as no budget", async () => {
    const { declaredJobBudgetMs } = await registryWith({ "unit-nan": () => Number.NaN, "unit-throws": () => { throw new Error("bad payload") } })
    expect(declaredJobBudgetMs("unit-nan", {})).toBeUndefined()
    expect(declaredJobBudgetMs("unit-throws", {})).toBeUndefined()
  })

  it("throws at load when a unit's type is also a legacy budget row", async () => {
    await expect(registryWith({ "apply-edl": () => 1 })).rejects.toThrow(/apply-edl is both a legacy entry and a node unit/)
  })

  it("with no unit budget, the registry is the legacy table alone", async () => {
    const { BUDGETED_JOB_NAMES } = await registryWith({})
    expect([...BUDGETED_JOB_NAMES].sort()).toEqual(["apply-edl", "audio-sync", "cast-swap", "silence-detect", "speaker-frames", "speaker-view", "split-media"])
  })
})
