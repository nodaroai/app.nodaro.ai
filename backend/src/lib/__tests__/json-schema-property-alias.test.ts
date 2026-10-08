/**
 * Property names that a schema validator reads as JSON-Schema keywords travel
 * under a wire alias and come back under the caller's own name.
 *
 * The proxied Gemini lane (KIE chat-completions) refuses a schema whose
 * object has a PROPERTY called `type` — it reads the name as the `type`
 * keyword: `(code 422) $.response_format.json_schema.schema.properties.person
 * .properties.type must be string or array`. The Person analyzer is such a
 * schema (its first dimension is `type`), so every Gemini Describe-to-Picker
 * run failed on that lane.
 */

import { describe, it, expect, vi } from "vitest"
import { z } from "zod"
import { buildMultiPickerAnalyzerSpec } from "@nodaro/prompts"

vi.mock("../config.js", () => ({ config: { KIE_API_KEY: "", ANTHROPIC_API_KEY: "", NODE_ENV: "test" } }))

import { aliasKeywordPropertyNames } from "../json-schema-property-alias.js"
import { structuredJsonSchema } from "../llm-client.js"

type Json = Record<string, unknown>

/** Every key of every `properties` map, at any depth. */
function propertyNames(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const entry of node) propertyNames(entry, out)
    return out
  }
  if (!node || typeof node !== "object") return out
  for (const [key, value] of Object.entries(node)) {
    if (key === "enum" || key === "const" || key === "default" || key === "examples") continue
    if (key === "properties" && value && typeof value === "object") {
      for (const [name, sub] of Object.entries(value)) {
        out.add(name)
        propertyNames(sub, out)
      }
      continue
    }
    propertyNames(value, out)
  }
  return out
}

describe("the Person analyzer schema", () => {
  const spec = buildMultiPickerAnalyzerSpec(["person"])
  const original = structuredJsonSchema(spec.schema as z.ZodType)
  const snapshot = structuredClone(original)
  const wire = aliasKeywordPropertyNames(original)
  const person = (schema: Json) => (schema.properties as Record<string, Json>).person as Json

  it("sends the `type` dimension under a wire name and keeps every other name and keyword", () => {
    expect([...wire.aliases]).toEqual([["type", "type_"]])
    const names = Object.keys(person(original).properties as Json)
    expect(Object.keys(person(wire.schema).properties as Json)).toEqual(names.map((n) => (n === "type" ? "type_" : n)))
    expect((person(wire.schema).properties as Json).type_).toEqual((person(original).properties as Json).type)
    expect(propertyNames(wire.schema).has("type")).toBe(false)
    expect(wire.schema.type).toBe("object")
    expect(person(wire.schema).type).toBe("object")
  })

  it("never changes the caller's schema", () => {
    expect(original).toEqual(snapshot)
  })

  it("an answer written under the wire name validates against the caller's schema once restored", () => {
    const answer = {
      person: { type_: "woman", age: "age-30s", ethnicity: ["east-asian"], "hair-color": ["hair-platinum"] },
      gaps: { missingItems: [], missingCategories: [] },
    }
    expect(spec.schema.safeParse(answer).success).toBe(false)
    const restored = wire.restore(answer)
    expect(restored).toEqual({
      person: { type: "woman", age: "age-30s", ethnicity: ["east-asian"], "hair-color": ["hair-platinum"] },
      gaps: { missingItems: [], missingCategories: [] },
    })
    expect(spec.schema.safeParse(restored).success).toBe(true)
  })
})

describe("aliasKeywordPropertyNames", () => {
  it("returns the caller's schema itself when no property is so named", () => {
    const schema = { type: "object", properties: { prompt: { type: "string" }, mood: { type: "string" } }, required: ["prompt"] }
    const text = JSON.stringify(schema)
    const wire = aliasKeywordPropertyNames(schema)
    expect(wire.schema).toBe(schema)
    expect(wire.aliases.size).toBe(0)
    const answer = { prompt: "a" }
    expect(wire.restore(answer)).toBe(answer)
    expect(JSON.stringify(wire.schema)).toBe(text)
  })

  it("renames a `type` inside an array's items, and the `required` list beside it", () => {
    const schema = {
      type: "object",
      properties: {
        shots: {
          type: "array",
          items: {
            type: "object",
            properties: { type: { type: "string", enum: ["wide", "close"] }, note: { type: "string" } },
            required: ["type", "note"],
            additionalProperties: false,
          },
        },
      },
      required: ["shots"],
      additionalProperties: false,
    }
    const wire = aliasKeywordPropertyNames(schema)
    const items = ((wire.schema.properties as Json).shots as Json).items as Json
    expect(Object.keys(items.properties as Json)).toEqual(["type_", "note"])
    expect(items.required).toEqual(["type_", "note"])
    expect(items.type).toBe("object")
    expect(wire.schema.required).toEqual(["shots"])
    expect(wire.restore({ shots: [{ type_: "wide", note: "a" }, { type_: "close", note: "b" }] }))
      .toEqual({ shots: [{ type: "wide", note: "a" }, { type: "close", note: "b" }] })
  })

  it("renames inside every branch of anyOf, oneOf and allOf", () => {
    const branch = (kind: string) => ({ type: "object", properties: { type: { const: kind } }, required: ["type"] })
    const schema = {
      type: "object",
      properties: {
        a: { anyOf: [branch("x"), { type: "null" }] },
        b: { oneOf: [branch("y"), branch("z")] },
        c: { allOf: [branch("w"), { type: "object", properties: { size: { type: "number" } } }] },
      },
    }
    const wire = aliasKeywordPropertyNames(schema)
    const props = wire.schema.properties as Record<string, Json>
    for (const node of [
      (props.a.anyOf as Json[])[0],
      (props.b.oneOf as Json[])[0],
      (props.b.oneOf as Json[])[1],
      (props.c.allOf as Json[])[0],
    ]) {
      expect(Object.keys(node.properties as Json)).toEqual(["type_"])
      expect(node.required).toEqual(["type_"])
    }
    expect((props.a.anyOf as Json[])[1]).toEqual({ type: "null" })
    expect(wire.restore({ a: { type_: "x" }, b: { type_: "z" }, c: { type_: "w", size: 2 } }))
      .toEqual({ a: { type: "x" }, b: { type: "z" }, c: { type: "w", size: 2 } })
  })

  it("renames inside $ref targets and rewrites a pointer that passes through a renamed property", () => {
    const schema = {
      type: "object",
      definitions: {
        shot: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
        // A definition's NAME is not an answer key — it keeps its name, and so does its pointer.
        type: { type: "string", enum: ["a", "b"] },
      },
      properties: {
        main: { $ref: "#/definitions/shot" },
        type: { type: "string" },
        same: { $ref: "#/properties/type" },
        kind: { $ref: "#/definitions/type" },
      },
    }
    const wire = aliasKeywordPropertyNames(schema)
    const defs = wire.schema.definitions as Record<string, Json>
    expect(Object.keys(defs)).toEqual(["shot", "type"])
    expect(Object.keys(defs.shot.properties as Json)).toEqual(["type_"])
    expect(defs.shot.required).toEqual(["type_"])
    const props = wire.schema.properties as Record<string, Json>
    expect(Object.keys(props)).toEqual(["main", "type_", "same", "kind"])
    expect(props.main.$ref).toBe("#/definitions/shot")
    expect(props.same.$ref).toBe("#/properties/type_")
    expect(props.kind.$ref).toBe("#/definitions/type")
    expect(wire.restore({ main: { type_: "a" }, type_: "b", same: "c", kind: "a" }))
      .toEqual({ main: { type: "a" }, type: "b", same: "c", kind: "a" })
  })

  it("renames the property names `dependencies` lists, in its keys and in its arrays", () => {
    const schema = {
      type: "object",
      properties: { type: { type: "string" }, size: { type: "number" } },
      dependencies: { type: ["size"], size: ["type"] },
    }
    const wire = aliasKeywordPropertyNames(schema)
    expect(wire.schema.dependencies).toEqual({ type_: ["size"], size: ["type_"] })
  })

  it("keeps a propertyNames list consistent: the names it allows follow the rename", () => {
    const schema = {
      type: "object",
      properties: { type: { type: "string" }, size: { type: "number" } },
      propertyNames: { enum: ["type", "size"] },
      additionalProperties: false,
    }
    const wire = aliasKeywordPropertyNames(schema)
    expect(wire.schema.propertyNames).toEqual({ enum: ["type_", "size"] })
    const single = aliasKeywordPropertyNames({ ...schema, propertyNames: { const: "type" } })
    expect(single.schema.propertyNames).toEqual({ const: "type_" })
  })

  it("never picks a wire name that a propertyNames list allows as one of the caller's keys", () => {
    const schema = {
      type: "object",
      properties: {
        type: { type: "string" },
        tags: { type: "object", propertyNames: { enum: ["type_", "mood"] }, additionalProperties: { type: "string" } },
      },
    }
    const wire = aliasKeywordPropertyNames(schema)
    expect([...wire.aliases]).toEqual([["type", "type__"]])
    expect((wire.schema.properties as Record<string, Json>).tags.propertyNames).toEqual({ enum: ["type_", "mood"] })
    expect(wire.restore({ type__: "a", tags: { type_: "b" } })).toEqual({ type: "a", tags: { type_: "b" } })
  })

  it("never renames a keyword, nor a property that only shares a keyword's name outside the set", () => {
    const schema = {
      type: "object",
      properties: {
        properties: { type: "object", properties: { type: { type: "string" } } },
        required: { type: "boolean" },
        items: { type: "array", items: { type: "string" } },
      },
      required: ["properties", "required"],
    }
    const wire = aliasKeywordPropertyNames(schema)
    const props = wire.schema.properties as Record<string, Json>
    expect(Object.keys(props)).toEqual(["properties", "required", "items"])
    expect(Object.keys(props.properties.properties as Json)).toEqual(["type_"])
    expect(props.properties.type).toBe("object")
    expect(props.items).toEqual({ type: "array", items: { type: "string" } })
    expect(wire.schema.required).toEqual(["properties", "required"])
  })

  it("leaves data alone: enum, const, default and examples values are answers, not schema", () => {
    const schema = {
      type: "object",
      properties: {
        type: { type: "string", enum: ["type", "kind"], default: "type" },
        meta: { type: "object", default: { type: "x" }, const: { type: "x" }, examples: [{ type: "x" }] },
      },
    }
    const wire = aliasKeywordPropertyNames(schema)
    const props = wire.schema.properties as Record<string, Json>
    expect(props.type_).toEqual({ type: "string", enum: ["type", "kind"], default: "type" })
    expect(props.meta).toEqual({ type: "object", default: { type: "x" }, const: { type: "x" }, examples: [{ type: "x" }] })
  })

  it("leaves patternProperties alone: its keys are patterns, and renaming one would change what it matches", () => {
    const schema = { type: "object", patternProperties: { type: { type: "string" } } }
    expect(aliasKeywordPropertyNames(schema).schema).toBe(schema)
  })

  it("picks a wire name no property of the caller's already uses", () => {
    const schema = {
      type: "object",
      properties: { type: { type: "string" }, nested: { type: "object", properties: { type_: { type: "string" } } } },
    }
    const wire = aliasKeywordPropertyNames(schema)
    expect([...wire.aliases]).toEqual([["type", "type__"]])
    expect(Object.keys(wire.schema.properties as Json)).toEqual(["type__", "nested"])
    expect(wire.restore({ type__: "a", nested: { type_: "b" } })).toEqual({ type: "a", nested: { type_: "b" } })
  })

  it("passes through an answer that already uses the caller's name", () => {
    const wire = aliasKeywordPropertyNames({ type: "object", properties: { type: { type: "string" } } })
    expect(wire.restore({ type: "a" })).toEqual({ type: "a" })
  })

  it("keeps the caller's name when an answer carries both, and leaves the wire name for validation to judge", () => {
    const wire = aliasKeywordPropertyNames({ type: "object", properties: { type: { type: "string" } } })
    expect(wire.restore({ type: "a", type_: "b" })).toEqual({ type: "a", type_: "b" })
  })

  it("restores at any depth, through arrays, and leaves primitives as they are", () => {
    const wire = aliasKeywordPropertyNames({ type: "object", properties: { type: { type: "string" } } })
    expect(wire.restore(["x", 1, null, true, { type_: "a", list: [{ type_: "b" }] }]))
      .toEqual(["x", 1, null, true, { type: "a", list: [{ type: "b" }] }])
  })

  it("restores an answer carrying a __proto__ key without touching any prototype", () => {
    const wire = aliasKeywordPropertyNames({ type: "object", properties: { type: { type: "string" } } })
    const restored = wire.restore(JSON.parse('{"__proto__":{"polluted":true},"type_":"a"}')) as Json
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype)
    expect((restored as { polluted?: unknown }).polluted).toBeUndefined()
    expect(JSON.stringify(restored)).toBe('{"__proto__":{"polluted":true},"type":"a"}')
  })
})
