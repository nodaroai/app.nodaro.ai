/**
 * `GET /v1/nodes` is the discovery contract SDK / CLI / MCP callers build
 * against. On an edition with no credit system it must not price anything —
 * telling a community install's callers "this node costs 3 credits" was the
 * editor's credit-badge bug one layer lower (#646, release check 34).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const editionMock = vi.hoisted(() => ({ credits: true }))
vi.mock("../config.js", async (orig) => {
  const actual = await orig<typeof import("../config.js")>()
  return { ...actual, hasCredits: () => editionMock.credits }
})

const { getEnrichedRegistry, findNode, NODE_REGISTRY } = await import("../node-registry.js")

describe("node registry × edition", () => {
  beforeEach(() => { editionMock.credits = true })

  it("cloud: descriptors carry creditCost (declared or enriched from STATIC_CREDIT_COSTS)", () => {
    const priced = getEnrichedRegistry().filter((d) => d.creditCost !== undefined)
    expect(priced.length).toBeGreaterThan(50)
    expect(findNode("generate-image")?.creditCost).toBeDefined()
  })

  it("community / business: NO descriptor carries creditCost — declared literals are stripped too", () => {
    editionMock.credits = false
    const all = getEnrichedRegistry()
    expect(all.length).toBe(NODE_REGISTRY.length) // nothing else changes
    expect(all.filter((d) => "creditCost" in d)).toEqual([])
    expect(findNode("generate-image")).toBeDefined()
    expect(findNode("generate-image")).not.toHaveProperty("creditCost")
  })
})
