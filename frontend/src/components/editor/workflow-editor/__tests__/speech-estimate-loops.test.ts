/**
 * The editor's estimate loops price speech by length when the server serves
 * the model's `:per-100-chars` row (length pricing on), and quote today's flat
 * row when it does not (flag off, or a cold cache). The id and the units come
 * from ONE call: a surface that returned the unit id with units 1, or the flat
 * id with units 80, would quote 4 or 2,400 credits — so both readers
 * (getModelIdentifier, getPricingUnits) are pinned to flip together here.
 *
 * The real helpers.ts is imported (no mock): the price cache is what is mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const cache = vi.hoisted(() => ({ prices: {} as Record<string, number | undefined> }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: (id: string) => cache.prices[id],
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { getPricingUnits, estimateNodeCredits, NODE_CREDIT_COSTS, NO_RERUNS } from "../types"
import { estimateRunCredits } from "../estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const e = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle }) as WorkflowEdge
const cached = (id: string) => cache.prices[id]

const literal1000 = n("t", "text-to-speech", { provider: "elevenlabs-v3", textSource: "direct", directText: "a".repeat(1000) })
const connected = n("c", "text-to-speech", { provider: "elevenlabs-v4", textSource: "connected" })
const textNode = n("s", "text-prompt", { text: "a".repeat(2500) })
const dialogue = n("d", "text-to-dialogue", { provider: "elevenlabs-dialogue-v4", dialogue: [{ text: "a".repeat(2500), voice: "R" }, { text: "b".repeat(2500), voice: "G" }] })

beforeEach(() => {
  cache.prices = {}
})

describe("with the unit rows served (length pricing on)", () => {
  beforeEach(() => {
    cache.prices = {
      "elevenlabs-v3": 30, "elevenlabs-v4": 30, "elevenlabs-dialogue-v4": 25,
      "elevenlabs-v3:per-100-chars": 4, "elevenlabs-v4:per-100-chars": 4, "elevenlabs-dialogue-v4:per-100-chars": 4,
    }
  })

  it("a literal text: the unit row, started hundreds, the product — on every reader", () => {
    expect(getModelIdentifier(literal1000, [], [literal1000])).toBe("elevenlabs-v3:per-100-chars")
    expect(getPricingUnits(literal1000, [literal1000], [], NO_RERUNS)).toBe(10)
    expect(estimateRunCredits([literal1000], [literal1000], [], cached)).toBe(40)
    // The cold-cache fallback is never reached on this path: a cached unit row
    // means getModelIdentifier named it and the loop read its price directly.
    expect(estimateNodeCredits(literal1000, [], [literal1000])).toBe(30)
  })

  it("a connected text: the cap (100 units on v4); a literal Text node one hop upstream: exact", () => {
    expect(getModelIdentifier(connected, [], [connected])).toBe("elevenlabs-v4:per-100-chars")
    expect(getPricingUnits(connected, [connected], [], NO_RERUNS)).toBe(100)
    expect(estimateRunCredits([connected], [connected], [], cached)).toBe(400)
    const edges = [e("s", "c", "prompt")]
    expect(getPricingUnits(connected, [connected, textNode], edges, NO_RERUNS)).toBe(25)
    expect(estimateRunCredits([connected], [connected, textNode], edges, cached)).toBe(100)
  })

  it("dialogue prices its lines on its own model's unit row", () => {
    expect(getModelIdentifier(dialogue, [], [dialogue])).toBe("elevenlabs-dialogue-v4:per-100-chars")
    expect(getPricingUnits(dialogue, [dialogue], [], NO_RERUNS)).toBe(50)
    expect(estimateRunCredits([dialogue], [dialogue], [], cached)).toBe(200)
  })
})

describe("with the unit rows not served (flag off, or a cold cache) — today's numbers", () => {
  it("the flat row, units 1, whatever the text — the id and the units flip together", () => {
    cache.prices = { "elevenlabs-v3": 30 }
    expect(getModelIdentifier(literal1000, [], [literal1000])).toBe("elevenlabs-v3")
    expect(getPricingUnits(literal1000, [literal1000], [], NO_RERUNS)).toBe(1)
    expect(estimateRunCredits([literal1000], [literal1000], [], cached)).toBe(30)
    expect(getPricingUnits(connected, [connected], [], NO_RERUNS)).toBe(1)
    expect(getModelIdentifier(dialogue, [], [dialogue])).toBe("elevenlabs-dialogue-v4")
    expect(getPricingUnits(dialogue, [dialogue], [], NO_RERUNS)).toBe(1)
  })

  it("a cold cache falls back to the node-type row, as before", () => {
    expect(estimateRunCredits([literal1000], [literal1000], [], cached)).toBe(NODE_CREDIT_COSTS["text-to-speech"])
    expect(NODE_CREDIT_COSTS["text-to-speech"]).toBe(30)
  })

  it("the unit ids are never in the cold-cache table (that would quote length prices against a flat-charging server)", () => {
    expect(Object.keys(NODE_CREDIT_COSTS).some((id) => id.endsWith(":per-100-chars"))).toBe(false)
  })
})
