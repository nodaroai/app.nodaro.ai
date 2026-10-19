// @vitest-environment node
// @test-watches tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/** frontend/src/nodes/**
import { describe, it, expect, vi } from "vitest"

/**
 * A worker node unit that declares a job budget (its backend budget.ts) runs
 * long, and gen:units says so in its editor definition (`longRunning: true`):
 * a reload re-attaches its poll for the 6 h horizon, as for every legacy long
 * job, with no hand list. The units come through the editor's one door to the
 * unit definitions; fixture-echo carries a budget.ts, so its golden definition
 * is flagged.
 */
vi.mock("@/lib/unit-definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/unit-definitions")>()
  const { definition } = await import("../../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated")
  const { longRunning: _flag, ...unflagged } = definition
  const units = [
    ...real.UNIT_NODE_DEFINITIONS,
    definition,
    { ...unflagged, type: "fixture-short" },
  ] as unknown as typeof real.UNIT_NODE_DEFINITIONS
  return { ...real, UNIT_NODE_DEFINITIONS: units, unitDefinitionOf: (t: string | undefined) => units.find((u) => u.type === t) }
})

const { LONG_RUNNING_NODE_TYPES, LONG_RUNNING_RESTORE_MAX_AGE_MS, SINGLE_NODE_RESTORE_MAX_AGE_MS, restoreMaxAgeMs } = await import("../single-node-restore")

describe("a node unit's restore horizon", () => {
  it("the golden definition of a unit with a budget.ts is flagged long-running", async () => {
    const { definition } = await import("../../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated")
    expect(definition.longRunning).toBe(true)
  })

  it("a unit flagged long-running gets the 6 h horizon; one without the flag keeps 30 minutes", () => {
    expect(LONG_RUNNING_NODE_TYPES.has("fixture-echo")).toBe(true)
    expect(restoreMaxAgeMs("fixture-echo")).toBe(LONG_RUNNING_RESTORE_MAX_AGE_MS)
    expect(LONG_RUNNING_NODE_TYPES.has("fixture-short")).toBe(false)
    expect(restoreMaxAgeMs("fixture-short")).toBe(SINGLE_NODE_RESTORE_MAX_AGE_MS)
  })

  it("the real units with a budget.ts are long-running (Speaker Map's whole-recording decode)", () => {
    expect(LONG_RUNNING_NODE_TYPES.has("speaker-map")).toBe(true)
    expect(restoreMaxAgeMs("speaker-map")).toBe(LONG_RUNNING_RESTORE_MAX_AGE_MS)
  })

  it("every legacy long job keeps its place", () => {
    for (const t of ["generate-video-pro", "edit-video-pro", "apply-edl", "audio-sync", "silence-detect"]) expect(LONG_RUNNING_NODE_TYPES.has(t), t).toBe(true)
  })
})
