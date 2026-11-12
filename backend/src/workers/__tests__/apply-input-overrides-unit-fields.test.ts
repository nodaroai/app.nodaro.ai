// @test-watches tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
import { describe, it, expect, vi } from "vitest"

/**
 * The ONE place every server run merges its overrides into node data (`applyInputOverridesToNodes`, called
 * once, by the orchestrator, for every lane and every continuation) holds a node unit's app fields
 * (unit.json `appFields`) to their declaration: an override outside it — `null` included, which the merge
 * would turn into a deleted key — throws `UnitFieldOverrideError` before ANY node is touched, and the
 * orchestrator fails the run with its message (unit-field-override-fails-execution.test.ts). A declared value
 * lands in the node's data, where `buildPayload` hands it to the unit's payload.ts (`UnitPayloadKit.data`).
 * A value the creator saved is not an override and is kept; a legacy node is never read. Proven on the
 * fixture unit `fixture-echo` (size: auto, 1K, 1.5K, 2K; maxLayers: 1–99), through its golden descriptor.
 */
vi.mock("../../lib/unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/unit-descriptors.js")>()
  const { descriptor } = await import("../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  const units = [...real.UNIT_NODE_DESCRIPTORS, descriptor as unknown as (typeof real.UNIT_NODE_DESCRIPTORS)[number]]
  return { ...real, UNIT_NODE_DESCRIPTORS: units, unitDescriptorOf: (t: string | undefined) => units.find((u) => u.type === t) }
})

const { applyInputOverridesToNodes } = await import("../apply-input-overrides.js")
const { UnitFieldOverrideError } = await import("../../lib/exposed-unit-field-check.js")

const graph = () => [
  { id: "text-1", type: "text-prompt", data: { text: "hello" } },
  { id: "v2v", type: "video-to-video", data: { provider: "wan" } },
  { id: "split", type: "fixture-echo", data: { label: "Layers", fieldMappings: {}, size: "1K", maxLayers: 9, videoUrl: "https://r2/in.mp4" } },
]

describe("an override of a unit's app field at the merge every run shares", () => {
  it("a declared value lands in the node's data; the rest of the node is kept", () => {
    const nodes = graph()
    applyInputOverridesToNodes(nodes, { split: { size: "2K", maxLayers: 42 } })
    expect(nodes[2]!.data).toEqual({ label: "Layers", fieldMappings: {}, size: "2K", maxLayers: 42, videoUrl: "https://r2/in.mp4" })
  })

  it("a value outside the declaration throws before any node is touched — the whole run, nothing partial", () => {
    const nodes = graph()
    const before = structuredClone(nodes)
    let thrown: unknown
    try {
      applyInputOverridesToNodes(nodes, { "text-1": { text: "a legitimate input" }, split: { maxLayers: 500 } })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(UnitFieldOverrideError)
    expect((thrown as Error).message).toBe("Invalid value for maxLayers: 500. Use a whole number between 1 and 99.")
    expect((thrown as InstanceType<typeof UnitFieldOverrideError>).code).toBe("validation_error")
    expect(nodes).toEqual(before)
  })

  it("null throws too: the merge would delete the key and the unit would read no value", () => {
    expect(() => applyInputOverridesToNodes(graph(), { split: { size: null } })).toThrow("Invalid value for size: null. Allowed: auto, 1K, 1.5K, 2K")
  })

  it("every refused value is named, in graph order", () => {
    expect(() => applyInputOverridesToNodes(graph(), { split: { size: "4K", maxLayers: 0 } })).toThrow(
      "Invalid value for size: 4K. Allowed: auto, 1K, 1.5K, 2K Invalid value for maxLayers: 0. Use a whole number between 1 and 99.",
    )
  })

  it("a value the creator saved is not an override: it is kept, whatever the declaration says", () => {
    const nodes = graph()
    nodes[2]!.data.maxLayers = 500
    applyInputOverridesToNodes(nodes, { split: { size: "auto" } })
    expect(nodes[2]!.data).toMatchObject({ size: "auto", maxLayers: 500 })
  })

  it("a legacy node is never read: any value merges as it did, null clears as it did", () => {
    const nodes = graph()
    applyInputOverridesToNodes(nodes, { v2v: { provider: "not-a-model", v2vResolution: null } })
    expect(nodes[1]!.data).toEqual({ provider: "not-a-model" })
  })
})
