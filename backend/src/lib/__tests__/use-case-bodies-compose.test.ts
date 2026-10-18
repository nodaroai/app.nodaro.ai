// @test-watches frontend/src/nodes/** backend/src/nodes/**
import { describe, expect, it } from "vitest"
import { USE_CASE_NODE_TYPES } from "@nodaro/render-rules"
import { USE_CASE_BODIES, usecaseBodyTakesNull, usecaseInputSchemaOf } from "../use-case/bodies.js"

/**
 * USE_CASE_BODIES composes every use-case unit's body (its use-case.ts, the
 * "use-cases" aggregate): every use-case type has exactly one body, which the
 * route factory parses with.
 */
describe("the composed use-case bodies", () => {
  it("every use-case type has a body", () => {
    expect(USE_CASE_NODE_TYPES.length).toBeGreaterThan(0)
    for (const type of USE_CASE_NODE_TYPES) expect(USE_CASE_BODIES[type]?.shape.mediaUrls, type).toBeDefined()
  })

  it("no body for a type that is not a use-case type", () => {
    expect(Object.keys(USE_CASE_BODIES).sort()).toEqual([...USE_CASE_NODE_TYPES].sort())
  })

  it("a setting whose None is not its default takes null (Tighten's framing); others do not", () => {
    expect(usecaseBodyTakesNull("tighten-episode", "framing")).toBe(true)
    expect(usecaseBodyTakesNull("tighten-episode", "captions")).toBe(false)
    expect(usecaseBodyTakesNull("tighten-episode", "no-such-key")).toBe(false)
  })

  it("a type that is not a use-case unit has no use-case input schema", () => {
    expect(usecaseInputSchemaOf("no-such-type")).toBeUndefined()
    expect(usecaseInputSchemaOf("constructor")).toBeUndefined()
  })
})
