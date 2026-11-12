/**
 * Split into Layers' app fields (unit.json `appFields`): in a published app,
 * Max layers is a 1–20 slider and Size a select of auto / 1K / 1.5K / 2K. The
 * listing's "up to" prices every combination, so it reads the 20-layer `2k`
 * row; a run may set the fields only to declared values, while the node's own
 * setting (and the direct route) keeps its 1–99 range.
 */
import { describe, it, expect } from "vitest"
import { listingCeiling, listingFieldDomains } from "../../../ee/billing/listing-range.js"
import { unitFieldRefusal } from "../../../lib/exposed-unit-field-check.js"
import { price, staticCosts } from "../price.ee.js"
import { descriptor } from "../descriptor.generated.js"
import { LAYER_SPLIT_SIZES } from "@nodaro/render-rules"

const NODES = [{ id: "split", type: descriptor.type, data: { label: "Layers", maxLayers: 9, size: "1K" } }]
const field = (f: string) => ({ type: "field", id: `f-${f}`, nodeId: "split", field: f })
const settings = { presentationSettings: { inputItems: [field("maxLayers"), field("size")] as never } }
const zero = { preview: 0, final: 0, previewPerMinute: 0, finalPerMinute: 0 }

describe("split-into-layers app fields", () => {
  it("the listing sees a 1–20 slider and the four sizes", () => {
    expect(listingFieldDomains(settings as never, NODES as never)).toEqual([
      { nodeId: "split", field: "maxLayers", values: [1, 20], model: false },
      { nodeId: "split", field: "size", values: ["auto", "1K", "1.5K", "2K"], model: false },
    ])
  })

  it("the listing's \"up to\" is the 20-layer 2K hold (the split-into-layers:2k:21 row)", async () => {
    const domains = listingFieldDomains(settings as never, NODES as never)
    const seen: string[] = []
    const ceiling = await listingCeiling(NODES as never, domains, zero, async (nodes) => {
      const id = price.creditId!((nodes[0] as { data: Record<string, unknown> }).data)
      seen.push(id)
      return { ...zero, final: (staticCosts as Record<string, number>)[id] ?? 0 }
    })
    expect(seen).toContain(`${descriptor.type}:2k:21`)
    expect(ceiling.final).toBe((staticCosts as Record<string, number>)[`${descriptor.type}:2k:21`])
  })

  it("a run may set Max layers from 1 to 20 and Size to its four values, nothing else", () => {
    for (const v of [1, 9, 20]) expect(unitFieldRefusal(descriptor.type, "maxLayers", v)).toBeNull()
    for (const v of [0, 21, 99, 2.5, "9"]) expect(unitFieldRefusal(descriptor.type, "maxLayers", v)).not.toBeNull()
    for (const v of ["auto", "1K", "1.5K", "2K"]) expect(unitFieldRefusal(descriptor.type, "size", v)).toBeNull()
    for (const v of ["4K", "", null]) expect(unitFieldRefusal(descriptor.type, "size", v)).not.toBeNull()
  })

  it("the declared sizes are the node's sizes: the route, the run rules and the app take one list", () => {
    const field = descriptor.appFields?.find((f) => f.field === "size")
    const values = field && field.kind === "select" ? field.options.map((o) => o.value) : []
    expect([...values].sort()).toEqual([...LAYER_SPLIT_SIZES].sort())
  })
})
