// @test-watches tools/fixtures/unit-quote-cases.json
/**
 * A per-unit run's QUOTE is its CHARGE. The server charges a run priced per
 * unit (minutes of a render, 5-second steps of a video utility, seconds of an
 * LTX extend or retake, started hundreds of a speech text) as ONE whole: the
 * row's base × the units, marked up and rounded up once. The editor used to
 * multiply the served one-unit price — already rounded up — by the units,
 * which quotes more (a 12-minute preview render: 24 for a run charged 14).
 *
 * The shared fixture (tools/fixtures/unit-quote-cases.json) holds one or more
 * cases for EVERY node type in the editor's per-unit registry, at a NON-ZERO
 * test margin where the two rules part; the backend suite
 * (ee/billing/__tests__/unit-quote-equals-charge.test.ts) holds the server's
 * charge and its price lookups to the same `credits`. Here the editor is held
 * to quote exactly that, and to ask the server for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const cache = vi.hoisted(() => ({ prices: {} as Record<string, number | undefined> }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  getCachedModelCredits: (id: string) => cache.prices[id],
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { PRICING_UNIT_NODE_TYPES, getExactPricingUnits, NO_RERUNS } from "../types"
import { estimateRunCredits, runModelIds } from "../estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { unitQuoteCredits, unitQuoteIdFor } from "@/lib/unit-quote"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

type Case = {
  name: string
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string; targetHandle: string }>
  node: string
  expect: { rateId: string; units: number; quoteId: string; servedUnit: number; credits: number; perUnitQuote: number }
}
const FIXTURE = resolve(__dirname, "../../../../../../tools/fixtures/unit-quote-cases.json")
const { cases } = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }

function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand)
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    if (typeof o.repeat === "number" && typeof o.of === "string") return ((o.prefix as string | undefined) ?? "") + o.of.repeat(o.repeat)
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v)]))
  }
  return value
}

function graph(c: Case) {
  const nodes = c.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 }, data: { label: n.id, ...(expand(n.data) as object) } }) as WorkflowNode)
  const edges = c.edges as WorkflowEdge[]
  return { nodes, edges, node: nodes.find((n) => n.id === c.node)! }
}

const cached = (id: string) => cache.prices[id]

beforeEach(() => {
  cache.prices = {}
})

describe("every per-unit node type is held to the server's charge", () => {
  it("the fixture has a case for every node type in the per-unit registry", () => {
    const covered = new Set(cases.map((c) => c.nodes.find((n) => n.id === c.node)!.type))
    expect(PRICING_UNIT_NODE_TYPES.filter((t) => !covered.has(t))).toEqual([])
  })

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const { nodes, edges, node } = graph(c)
    // The server serves the one-unit row: the editor prices on it, at the run's exact units.
    cache.prices = { [c.expect.rateId]: c.expect.servedUnit }
    const rateId = getModelIdentifier(node, edges, nodes, new Set([node.id]))
    const units = getExactPricingUnits(node, nodes, edges, new Set([node.id]))
    expect({ rateId, units }).toEqual({ rateId: c.expect.rateId, units: c.expect.units })
    expect(unitQuoteIdFor(rateId, units)).toBe(c.expect.quoteId)

    // It asks the server for the whole run's price beside the row.
    expect(runModelIds([node], nodes, edges)).toEqual(expect.arrayContaining([c.expect.rateId, c.expect.quoteId]))

    // Until the whole price is cached: the old rule, an upper bound that quotes more than the charge.
    expect(estimateRunCredits([node], nodes, edges, cached)).toBe(c.expect.perUnitQuote)
    expect(c.expect.perUnitQuote).toBeGreaterThan(c.expect.credits)

    // With the server's answer cached: the run total, the precheck and the pill quote the charge.
    cache.prices = { [c.expect.rateId]: c.expect.servedUnit, [c.expect.quoteId]: c.expect.credits }
    expect(estimateRunCredits([node], nodes, edges, cached)).toBe(c.expect.credits)
    expect(unitQuoteCredits(c.expect.rateId, c.expect.units, cached)).toBe(c.expect.credits)
  })
})

describe("the whole-run quote id", () => {
  it("is not asked for a single unit — the row is its own price", () => {
    expect(unitQuoteIdFor("trim-video", 1)).toBeUndefined()
    expect(unitQuoteIdFor(undefined, 5)).toBeUndefined()
    expect(unitQuoteIdFor("trim-video", 5)).toBe("trim-video:5u")
  })

  it("names fractional units exactly as the server reads them back", () => {
    expect(unitQuoteIdFor("ltx-2.3-pro-retake:per-second", 2.5)).toBe("ltx-2.3-pro-retake:per-second:2.5u")
    expect(unitQuoteIdFor("ltx-2.3-pro-retake:per-second", 2 + 1 / 3)).toBe(`ltx-2.3-pro-retake:per-second:${String(2 + 1 / 3)}u`)
  })

  it("falls back to the one-unit price × whole units — never below the charge — until the whole price is cached", () => {
    expect(unitQuoteCredits("ltx-2.3-pro-retake:per-second", 2.5, (id) => (id.endsWith(":per-second") ? 45 : undefined))).toBe(135)
    expect(unitQuoteCredits("trim-video", 1, (id) => (id === "trim-video" ? 12 : undefined))).toBe(12)
    expect(unitQuoteCredits("trim-video", 5, () => undefined)).toBeUndefined()
  })
})

describe("estimate loops with no whole price cached keep today's numbers", () => {
  it("the cold-cache path still prices every unit (the code fallback × units)", () => {
    const c = cases.find((x) => x.expect.rateId === "apply-edl")!
    const { nodes, edges, node } = graph(c)
    expect(estimateRunCredits([node], nodes, edges, cached)).toBeGreaterThanOrEqual(c.expect.units)
    expect(getExactPricingUnits(node, nodes, edges, NO_RERUNS)).toBe(c.expect.units)
  })
})
