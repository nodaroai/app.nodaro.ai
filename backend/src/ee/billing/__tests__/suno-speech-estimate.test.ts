// @test-units-by-name prices one node type by name (suno-speech) through the run estimate's own resolver
/**
 * Suno Speech is one flat row everywhere a price is read (decided 2026-11-17):
 * the run estimate resolves the node to the id the route's guard, its
 * reservation, the quote and the workflow payload hold (the unit's own tests,
 * backend/src/nodes/suno-speech/__tests__/route.test.ts), whatever the mode or
 * settings, and that row is the unit's price.
 */
import { describe, it, expect } from "vitest"
import { STATIC_CREDIT_COSTS, getNodeModelIdentifier } from "../credits.js"

const node = (data: Record<string, unknown>) => ({ id: "n1", type: "suno-speech", data })

describe("Suno Speech — the run estimate", () => {
  it.each([
    ["a Brief run", { mode: "brief", prompt: "A short morning news intro" }],
    ["a Script run with every option", { mode: "script", script: "Hello.", tone: "warm", variety: 4, vocalGender: "female", backgroundMusic: true }],
    ["a node with no settings", {}],
  ])("%s is estimated on the flat row", (_name, data) => {
    expect(getNodeModelIdentifier(node(data) as Parameters<typeof getNodeModelIdentifier>[0], {})).toBe("suno-speech")
  })

  it("the row is 30 credits before the deployment's markup", () => {
    expect(STATIC_CREDIT_COSTS["suno-speech"]).toBe(30)
  })
})
