// @test-watches tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/** backend/src/nodes/**
import { describe, it, expect, vi } from "vitest"
import type { UnitDescriptor } from "../../../nodes/kit.js"
import type * as Golden from "../../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js"

// A descriptor that carries appFields is a UnitDescriptor: the shape gen:units projects fits the server kit
// (the registry aggregate types every member with it). Type-level: npm run typecheck holds it.
type IsDescriptor<T extends UnitDescriptor> = T
export type ProjectionFitsTheKit = IsDescriptor<typeof Golden.descriptor>

/**
 * A node unit's app fields (unit.json `appFields`, tools/units/README.md "A unit's app fields") on the server,
 * proven on the fixture unit `fixture-echo` through its golden descriptor (the projection gen:units writes),
 * read through the server's one door to the unit descriptors: what `get_app_inputs` and the SDK's flat inputs
 * see, what the published listing prices, and what an app run is held to — the same wording a legacy field
 * derived from a quick-strip control with a fixed list is refused with.
 */
vi.mock("../../unit-descriptors.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../unit-descriptors.js")>()
  const { descriptor } = await import("../../../../../tools/units/__fixtures__/expected/backend/src/nodes/fixture-echo/descriptor.generated.js")
  const units = [...real.UNIT_NODE_DESCRIPTORS, descriptor as unknown as (typeof real.UNIT_NODE_DESCRIPTORS)[number]]
  return { ...real, UNIT_NODE_DESCRIPTORS: units, unitDescriptorOf: (t: string | undefined) => units.find((u) => u.type === t) }
})

const { extractAppInputSchema, flatInputsToOverrides } = await import("../extract-app-inputs.js")
const { exposedUnitFieldSpec, findUnitFieldOverrideRefusals, unitFieldRefusal } = await import("../../exposed-unit-field-check.js")
const { quickFieldRefusal } = await import("../../exposed-quick-field-check.js")
const { listingFieldDomains } = await import("../../../ee/billing/listing-range.js")

const NODES = [
  { id: "split", type: "fixture-echo", data: { label: "Layers", size: "1K", maxLayers: 9 } },
  { id: "v2v", type: "video-to-video", data: { label: "Restyle" } },
]
const field = (f: string, extra: Record<string, unknown> = {}) => ({ type: "field", id: `f-${f}`, nodeId: "split", field: f, ...extra })
const settings = (items: unknown[]) => ({ presentationSettings: { inputItems: items as never } })
const app = (items: unknown[]) => extractAppInputSchema({ snapshotSettings: settings(items), snapshotNodes: NODES })

describe("get_app_inputs — a unit's app fields", () => {
  it("a select is a select of exactly its values; an integer a number with its range and step", () => {
    const schema = app([field("size"), field("maxLayers")])
    expect(schema.fields).toEqual([
      { key: "layers_size", label: "Layers: size", type: "select", required: false, options: ["auto", "1K", "1.5K", "2K"] },
      { key: "layers_maxlayers", label: "Layers: maxLayers", type: "number", required: false, min: 1, max: 99, step: 1, description: "A whole number from 1 to 99." },
    ])
  })

  it("a flat input lands on the node's field, a number's numeric string as the number", () => {
    const { keyMap } = app([field("size"), field("maxLayers")])
    expect(flatInputsToOverrides({ layers_size: "2K", layers_maxlayers: "42" }, keyMap)).toEqual({ split: { size: "2K", maxLayers: 42 } })
  })

  it("a flat input naming a field the creator did not expose is dropped, as for any node", () => {
    const { keyMap } = app([field("size")])
    expect(flatInputsToOverrides({ layers_size: "2K", layers_maxlayers: 42, maxLayers: 42 }, keyMap)).toEqual({ split: { size: "2K" } })
  })

  it("a publisher's restriction is a select of the allowed values, as on a legacy field", () => {
    const schema = app([field("size", { allowedValues: ["1K", "2K"] })])
    expect(schema.fields[0]).toMatchObject({ type: "select", options: ["1K", "2K"] })
  })

  it("the listing's \"up to\" prices every value a select takes and an integer's two ends", () => {
    const domains = listingFieldDomains(settings([field("size"), field("maxLayers")]), NODES as never)
    expect(domains).toEqual([
      { nodeId: "split", field: "size", values: ["auto", "1K", "1.5K", "2K"], model: false },
      { nodeId: "split", field: "maxLayers", values: [1, 99], model: false },
    ])
  })
})

describe("unitFieldRefusal — what an app run holds a unit's app field to", () => {
  it("finds a unit's field by its stored key, and nothing for a legacy node or an undeclared field", () => {
    expect(exposedUnitFieldSpec("fixture-echo", "size")?.kind).toBe("select")
    expect(exposedUnitFieldSpec("fixture-echo", "videoUrl")).toBeUndefined()
    expect(exposedUnitFieldSpec("video-to-video", "provider")).toBeUndefined()
    expect(exposedUnitFieldSpec(undefined, "size")).toBeUndefined()
  })

  it("a select takes one of its values, nothing else", () => {
    for (const v of ["auto", "1K", "1.5K", "2K"]) expect(unitFieldRefusal("fixture-echo", "size", v)).toBeNull()
    expect(unitFieldRefusal("fixture-echo", "size", "4K")).toBe("Invalid value for size: 4K. Allowed: auto, 1K, 1.5K, 2K")
    expect(unitFieldRefusal("fixture-echo", "size", 1)).toMatch(/^Invalid value for size: 1\. Allowed:/)
  })

  it("an integer takes a whole number in its range, nothing else", () => {
    for (const v of [1, 9, 99]) expect(unitFieldRefusal("fixture-echo", "maxLayers", v)).toBeNull()
    const refused = "Use a whole number between 1 and 99."
    for (const v of [0, 100, 9.5, "9", Number.NaN, true]) expect(unitFieldRefusal("fixture-echo", "maxLayers", v), String(v)).toContain(refused)
    expect(unitFieldRefusal("fixture-echo", "maxLayers", 100)).toBe(`Invalid value for maxLayers: 100. ${refused}`)
  })

  it("null is refused (the merge would delete the key); a legacy node's field is not this check's", () => {
    expect(unitFieldRefusal("fixture-echo", "maxLayers", null)).toBe("Invalid value for maxLayers: null. Use a whole number between 1 and 99.")
    expect(unitFieldRefusal("fixture-echo", "size", null)).toBe("Invalid value for size: null. Allowed: auto, 1K, 1.5K, 2K")
    expect(unitFieldRefusal("video-to-video", "provider", "not-a-model")).toBeNull()
    expect(unitFieldRefusal("video-to-video", "provider", null)).toBeNull()
  })

  it("findUnitFieldOverrideRefusals: every override on a unit's app field, exposed or not, by graph and lookup", () => {
    const nodes = [{ id: "split", type: "fixture-echo" }, { id: "v2v", type: "video-to-video" }, { id: "split", type: "fixture-echo" }]
    const refusals = findUnitFieldOverrideRefusals(nodes, {
      split: { size: "1K", maxLayers: 500, promptPrefix: "anything", videoUrl: "https://x" },
      v2v: { provider: "not-a-model" },
      nowhere: { maxLayers: 500 },
    })
    // The duplicated node id is checked once per entry; the legacy node, an undeclared key and a missing node are not read.
    expect(refusals).toEqual([{ nodeId: "split", nodeType: "fixture-echo", field: "maxLayers", message: "Invalid value for maxLayers: 500. Use a whole number between 1 and 99." }])
    expect(findUnitFieldOverrideRefusals(nodes, undefined)).toEqual([])
    expect(findUnitFieldOverrideRefusals(null, { split: { maxLayers: 500 } })).toEqual([])
  })

  it("its wording is a legacy fixed-list field's (quickFieldRefusal)", () => {
    const legacy = quickFieldRefusal("video-to-video", "provider", "not-a-model")!
    expect(legacy).toMatch(/^Invalid value for provider: not-a-model\. Allowed: /)
    expect(unitFieldRefusal("fixture-echo", "size", "not-a-size")).toMatch(/^Invalid value for size: not-a-size\. Allowed: /)
  })
})
