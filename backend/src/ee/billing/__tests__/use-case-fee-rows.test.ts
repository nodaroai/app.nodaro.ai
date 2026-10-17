// @test-units-by-name looks up only the use-case types it names (the registry's use-case list and the three P2 types), never every node
/**
 * Every podcast use-case node's per-run fee is a priced row, and the node's own
 * charge names it. The three nodes still to come (Chapters, Trailer, Clip
 * Pack) are priced ahead of their registration (decided 2026-10-14) by
 * hand-written rows, so a type added to the registry can never be charged a fee
 * nobody priced. The type list is de-duplicated: once a type is registered it
 * is listed once.
 */
import { describe, it, expect } from "vitest"
import { USE_CASE_FEE_STATIC_CREDITS, USE_CASE_NODE_TYPES, usecaseFeeCreditId } from "@nodaro/render-rules"
import { CREDIT_COSTS, STATIC_CREDIT_COSTS } from "../credits.js"

const P2_TYPES = ["episode-chapters", "episode-trailer", "clip-pack"] as const

describe("use-case fee rows", () => {
  for (const type of new Set<string>([...USE_CASE_NODE_TYPES, ...P2_TYPES])) {
    it(`${type}: use-case-fee:${type} = ${USE_CASE_FEE_STATIC_CREDITS}, and the node's own charge is that fee`, () => {
      expect(STATIC_CREDIT_COSTS[`use-case-fee:${type}`]).toBe(USE_CASE_FEE_STATIC_CREDITS)
      expect(CREDIT_COSTS[type]?.({})).toBe(`use-case-fee:${type}`)
    })
  }
  it("the registry's fee id is the same id", () => {
    for (const type of USE_CASE_NODE_TYPES) expect(usecaseFeeCreditId(type)).toBe(`use-case-fee:${type}`)
  })
})
