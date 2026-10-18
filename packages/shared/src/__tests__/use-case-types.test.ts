import { describe, expect, expectTypeOf, it } from "vitest"
// Through the entry consumers import (`@nodaro/shared/nodes`).
import { USE_CASE_NODE_TYPES, isUseCaseNodeType, type UseCaseNodeType } from "../entries/nodes.js"
import { UNIT_USE_CASE_TYPES } from "../generated/unit-contracts.js"

describe("USE_CASE_NODE_TYPES: the public use-case node types", () => {
  // Their order is the editor's composed order (frontend units-vocabulary.test.ts guards it).
  it("lists the use-case units' types, each once", () => {
    expect(USE_CASE_NODE_TYPES.length).toBeGreaterThan(0)
    expect([...USE_CASE_NODE_TYPES]).toEqual([...UNIT_USE_CASE_TYPES])
    expect(new Set(USE_CASE_NODE_TYPES).size).toBe(USE_CASE_NODE_TYPES.length)
  })

  it("isUseCaseNodeType answers for the listed strings only, whatever it is handed", () => {
    for (const t of USE_CASE_NODE_TYPES) expect(isUseCaseNodeType(t)).toBe(true)
    expect(isUseCaseNodeType("constructor")).toBe(false)
    expect(isUseCaseNodeType("apply-edl")).toBe(false)
    expect(isUseCaseNodeType("")).toBe(false)
    expect(isUseCaseNodeType(null)).toBe(false)
    expect(isUseCaseNodeType(undefined)).toBe(false)
    expect(isUseCaseNodeType(42)).toBe(false)
    expect(isUseCaseNodeType({ type: "tighten-episode" })).toBe(false)
  })

  it("UseCaseNodeType is a literal union, and the guard narrows an unknown to it", () => {
    // The units' literal types — never widened to string.
    expectTypeOf<UseCaseNodeType>().toEqualTypeOf<(typeof UNIT_USE_CASE_TYPES)[number]>()
    expectTypeOf<string>().not.toExtend<UseCaseNodeType>()
    expectTypeOf(isUseCaseNodeType).parameter(0).toBeUnknown()
    const value: unknown = "episode-chapters"
    if (isUseCaseNodeType(value)) expectTypeOf(value).toEqualTypeOf<UseCaseNodeType>()
  })
})
