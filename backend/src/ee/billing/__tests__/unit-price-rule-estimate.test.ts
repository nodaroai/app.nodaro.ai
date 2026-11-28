// @test-units-by-name prices the node types it names (long-image, split-into-layers, upload-image) through the run estimate's own resolver
/**
 * A node unit priced by its settings is estimated on the row its run is
 * charged, by the unit's own rule (its price.ee.ts `creditId`), handed the
 * node's wired inputs when the graph is known — as the editor's estimate is.
 * Before, the server's estimate fell through to the unit's bare row whatever
 * its settings: Long Image quoted its default row for every run, and Split into
 * Layers its default hold (Max layers 9 at 1K) for every Max layers and size.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { settings } = vi.hoisted(() => ({
  settings: { value: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> } },
}))

function modelPricingQuery() {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    range: async () => ({ data: [], error: null }),
  }
  return query
}

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.value }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true }
})

import { CreditsService, STATIC_CREDIT_COSTS, getNodeModelIdentifier, invalidateModelPricingCache } from "../credits.js"

type EstimateNode = Parameters<typeof getNodeModelIdentifier>[0]
const row = (id: string) => STATIC_CREDIT_COSTS[id]!
const longImage = (data: Record<string, unknown>) => ({ id: "li", type: "long-image", data: { label: "Long Image", ...data } })
const upload = (id: string) => ({ id, type: "upload-image", data: { label: id, url: `https://r2.test/${id}.png` } })
const wire = (source: string, targetHandle: string) => ({ source, target: "li", sourceHandle: "image", targetHandle })
const estimate = (nodes: Array<Record<string, unknown>>, edges?: Array<Record<string, unknown>>) =>
  CreditsService.estimateWorkflowCredits(nodes as never, edges as never)

beforeEach(() => invalidateModelPricingCache())

describe("Long Image — the run estimate prices the row its run is charged", () => {
  it("with the graph: the mode, length, size and each wired picture input of the mode", async () => {
    expect(await estimate([longImage({ mode: "webpage", resolution: "2K" })], [])).toBe(row("long-image:webpage:2K"))
    expect(await estimate([upload("s"), longImage({ mode: "webpage", resolution: "2K" })], [wire("s", "styleImage")])).toBe(row("long-image:webpage:2K:1ref"))
    expect(
      await estimate([upload("a"), upload("b"), longImage({ mode: "ecommerce", length: "long", resolution: "1K" })], [wire("a", "productImage1"), wire("b", "productImage3")]),
    ).toBe(row("long-image:ecommerce:long:1K:2ref"))
    // A picture wired into the other mode's input is not sent: not priced.
    expect(await estimate([upload("p"), longImage({ mode: "webpage", resolution: "1K" })], [wire("p", "productImage1")])).toBe(row("long-image:webpage:1K"))
  })

  it("without the graph: the most pictures its mode can send, never below the run", async () => {
    expect(await estimate([longImage({ mode: "webpage" })])).toBe(row("long-image:webpage:2K:2ref"))
    expect(await estimate([longImage({ mode: "ecommerce", length: "medium" })])).toBe(row("long-image:ecommerce:medium:2K:3ref"))
  })

  it("the resolver it reads, with and without the wired inputs", () => {
    const node = longImage({ mode: "ecommerce", length: "short", resolution: "1K" }) as EstimateNode
    expect(getNodeModelIdentifier(node, { wiredInputs: new Set(["productImage2"]) })).toBe("long-image:ecommerce:short:1K:1ref")
    expect(getNodeModelIdentifier(node, {})).toBe("long-image:ecommerce:short:1K:3ref")
  })
})

describe("Split into Layers — the run estimate prices its hold for its settings", () => {
  it.each([
    // [settings, the row it is estimated on now; before, every one was the bare row "split-into-layers"]
    [{}, "split-into-layers:1k:10"],
    [{ maxLayers: 5, size: "1K" }, "split-into-layers:1k:6"],
    [{ maxLayers: 3, size: "2K" }, "split-into-layers:2k:4"],
    [{ maxLayers: 20, size: "auto" }, "split-into-layers:2k:21"],
  ])("%o is estimated on %s", async (data, id) => {
    const node = { id: "s", type: "split-into-layers", data: { label: "Split", imageUrl: "https://r2.test/p.png", ...data } }
    expect(getNodeModelIdentifier(node as EstimateNode, {})).toBe(id)
    expect(await estimate([node], [])).toBe(row(id))
  })

  it("the defaults' hold is the bare row, so a node at its defaults is estimated as before", () => {
    expect(row("split-into-layers:1k:10")).toBe(row("split-into-layers"))
    // Before this change a node with Max layers 5 at 1K was quoted the bare row; now its hold.
    expect([row("split-into-layers"), row("split-into-layers:1k:6")]).toEqual([94, 58])
  })
})
