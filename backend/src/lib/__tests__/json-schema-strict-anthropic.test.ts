import { describe, it, expect } from "vitest"
import { anthropicStrictToolSchema } from "../json-schema-strict.js"

describe("anthropicStrictToolSchema", () => {
  it("withholds the keywords strict mode refuses, at every depth", () => {
    const out = anthropicStrictToolSchema({
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 9, pattern: "^a" },
        n: { type: "integer", minimum: 0, maximum: 5, multipleOf: 1, exclusiveMaximum: 6 },
        tags: { type: "array", items: { type: "string", maxLength: 3 }, maxItems: 4, uniqueItems: true, minItems: 2 },
        one: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["name"],
    })
    expect(out).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        n: { type: "integer" },
        tags: { type: "array", items: { type: "string" } },
        one: { type: "array", items: { type: "string" }, minItems: 1 },
      },
      required: ["name"],
    })
  })

  it("closes every object, including nested and array-item objects", () => {
    const out = anthropicStrictToolSchema({
      type: "object",
      properties: { shots: { type: "array", items: { type: "object", properties: { id: { type: "string" } } } } },
    }) as Record<string, any>
    expect(out.additionalProperties).toBe(false)
    expect(out.properties.shots.items.additionalProperties).toBe(false)
  })

  it("keeps a property NAMED like a withheld keyword", () => {
    const out = anthropicStrictToolSchema({ type: "object", properties: { maximum: { type: "number" }, pattern: { type: "string" } } })
    expect(Object.keys((out as Record<string, any>).properties)).toEqual(["maximum", "pattern"])
  })

  it("leaves enum / const values alone", () => {
    const out = anthropicStrictToolSchema({ type: "object", properties: { k: { type: "string", enum: ["minimum", "maxLength"] } } })
    expect((out as Record<string, any>).properties.k.enum).toEqual(["minimum", "maxLength"])
  })

  it("is undefined for a map (z.record), a passthrough object, or any $ref", () => {
    expect(anthropicStrictToolSchema({ type: "object", additionalProperties: { type: "string" } })).toBeUndefined()
    expect(anthropicStrictToolSchema({ type: "object", properties: { a: { type: "object", additionalProperties: {} } } })).toBeUndefined()
    expect(anthropicStrictToolSchema({ type: "object", properties: { a: { $ref: "#/$defs/A" } }, $defs: { A: { type: "string" } } })).toBeUndefined()
  })

  it("never mutates its input", () => {
    const input = { type: "object", properties: { s: { type: "string", maxLength: 2 } } }
    anthropicStrictToolSchema(input)
    expect(input).toEqual({ type: "object", properties: { s: { type: "string", maxLength: 2 } } })
  })
})
