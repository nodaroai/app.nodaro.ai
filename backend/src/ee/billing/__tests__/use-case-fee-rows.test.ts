// @test-units-by-name looks up only the use-case types (the registry's use-case list and the two types priced ahead of their node), never every node
/**
 * Every podcast use-case node's per-run fee is a priced row, and the node's own
 * charge names it. Trailer and Clip Pack are priced ahead of their node
 * (decided 2026-10-14) by hand-written rows: no node of either type exists on
 * this branch, so no CREDIT_COSTS resolver names them (decided 2026-10-18 —
 * the ids stay free for their units) and only their rows are held here. A
 * type in both lists — a priced-ahead type that became a node — is held as a
 * node.
 */
import { describe, it, expect } from "vitest"
import { USE_CASE_FEE_STATIC_CREDITS, USE_CASE_NODE_TYPES, usecaseFeeCreditId } from "@nodaro/render-rules"
import { CREDIT_COSTS, STATIC_CREDIT_COSTS } from "../credits.js"

const PRICED_AHEAD = ["episode-trailer", "clip-pack"] as const
const FEE_PREFIX = "use-case-fee:"
const nodes = new Set<string>(USE_CASE_NODE_TYPES)

describe("use-case fee rows", () => {
  for (const type of USE_CASE_NODE_TYPES) {
    it(`${type} (a node): ${FEE_PREFIX}${type} = ${USE_CASE_FEE_STATIC_CREDITS}, and the node's own charge is that fee`, () => {
      expect(STATIC_CREDIT_COSTS[`${FEE_PREFIX}${type}`]).toBe(USE_CASE_FEE_STATIC_CREDITS)
      expect(CREDIT_COSTS[type]?.({})).toBe(`${FEE_PREFIX}${type}`)
    })
  }
  for (const type of PRICED_AHEAD.filter((t) => !nodes.has(t))) {
    it(`${type} (priced ahead of its node): ${FEE_PREFIX}${type} = ${USE_CASE_FEE_STATIC_CREDITS}`, () => {
      expect(STATIC_CREDIT_COSTS[`${FEE_PREFIX}${type}`]).toBe(USE_CASE_FEE_STATIC_CREDITS)
    })
  }
  it("every fee row is a use-case node's or a type priced ahead of its node", () => {
    const known = new Set<string>([...USE_CASE_NODE_TYPES, ...PRICED_AHEAD])
    const rows = Object.keys(STATIC_CREDIT_COSTS).filter((id) => id.startsWith(FEE_PREFIX)).map((id) => id.slice(FEE_PREFIX.length))
    expect(rows.filter((t) => !known.has(t))).toEqual([])
  })
  it("the registry's fee id is the same id", () => {
    for (const type of USE_CASE_NODE_TYPES) expect(usecaseFeeCreditId(type)).toBe(`${FEE_PREFIX}${type}`)
  })
})
