// @test-watches tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
/**
 * POST /v1/<use-case>/continue re-applies the earlier run's overrides (its pin, with this continuation's
 * own over it — `continuationInputOverrides`, as the orchestrator merges them). A node unit's app field
 * (unit.json `appFields`) set there outside its declaration is refused up front, with the declaration's 400,
 * before any balance check, claim, fee or run (lib/exposed-unit-field-check.ts).
 *
 * The use-case graph's plan node stands in for a unit here: the units door answers its type with the fixture
 * unit's descriptor (`fixture-echo`: size auto/1K/1.5K/2K, maxLayers 1–99), so the route's own wiring is
 * what is proven, on the harness's real stored graph.
 */
import { ID, failedSource, nothingWritten, post, src } from "./helpers/use-case-continue-harness.js"
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/unit-descriptors.js", async (importOriginal) => {
  const real = (await importOriginal()) as typeof import("../../lib/unit-descriptors.js")
  const { descriptor } = await import("../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  const asPlan = { ...descriptor, type: "edit-plan" } as unknown as (typeof real.UNIT_NODE_DESCRIPTORS)[number]
  return { ...real, unitDescriptorOf: (t: string | undefined) => (t === "edit-plan" ? asPlan : real.unitDescriptorOf(t)) }
})

describe("a use-case continuation holds a unit's app fields on the overrides it re-applies", () => {
  it("a pinned value outside the declaration: 400 validation_error with its wording, nothing written", async () => {
    src.source = { ...failedSource, inputOverrides: { "uc-plan": { maxLayers: 500 } } }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "validation_error", message: "Invalid value for maxLayers: 500. Use a whole number between 1 and 99." })
    nothingWritten()
  })

  it("a pinned null is refused too", async () => {
    src.source = { ...failedSource, inputOverrides: { "uc-plan": { size: null } } }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("Invalid value for size: null. Allowed: auto, 1K, 1.5K, 2K")
    nothingWritten()
  })

  it("a pinned declared value continues as usual", async () => {
    src.source = { ...failedSource, inputOverrides: { "uc-plan": { maxLayers: 12 } } }
    const res = await post({ jobId: ID, mode: "from-failed" })
    expect(res.statusCode).toBe(202)
  })
})
