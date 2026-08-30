/**
 * The validation surface of POST /v1/llm/structured, tested as pure functions.
 *
 * Two of these pin BEHAVIOUR OF ZOD ITSELF (`z.fromJSONSchema` is
 * semi-experimental in 4.4): what it refuses outright, and the one constraint
 * it accepts and silently drops. Both are load-bearing for the route's
 * contract, so a zod upgrade that changes either fails here.
 */
import { describe, it, expect } from "vitest"
import {
  JSON_SCHEMA_MAX_BYTES,
  JSON_SCHEMA_MAX_DEPTH,
  convertJsonSchema,
  digestText,
  jsonSchemaDepth,
  llmStructuredBody,
} from "../llm-structured.js"

/** A concrete `id | id[]` union — the picks/look value shape studio emits. */
const ID_OR_IDS = {
  anyOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 4 }],
}
const LEVER = {
  type: "object",
  properties: {
    id: { type: "string" },
    position: { type: "string" },
    duration: { type: "string" },
    intensity: { type: "string" },
  },
  required: ["id"],
  additionalProperties: false,
}
/** A stand-in for `renderStructuralJsonSchema()` — the same shape, and its
 *  deepest real path is scenes[] → items → shots[] → items → picks →
 *  additionalProperties → anyOf → array → items. */
const STUDIO_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    format: { type: "string", const: "nodaro-studio-production" },
    version: { type: "integer", minimum: 1 },
    title: { type: "string", maxLength: 200 },
    film: { type: "object", additionalProperties: ID_OR_IDS },
    folders: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          folder: { type: "string" },
          look: { type: "object", additionalProperties: ID_OR_IDS },
          frame: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              model: { type: "string" },
              count: { type: "integer", minimum: 1, maximum: 10 },
              referenceImageUrls: { type: "array", items: { type: "string" } },
            },
            required: ["prompt"],
            additionalProperties: false,
          },
          motion: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              model: { type: "string" },
              duration: { type: "number" },
              cameraMotionId: { type: "string" },
            },
            additionalProperties: false,
          },
          shots: {
            type: "array",
            items: {
              type: "object",
              properties: {
                seconds: { type: "number", exclusiveMinimum: 0, multipleOf: 0.1 },
                text: { type: "string" },
                label: { type: "string" },
                picks: { type: "object", additionalProperties: ID_OR_IDS },
                transition: LEVER,
                characterFx: LEVER,
              },
              required: ["seconds", "text"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  required: ["format", "version", "scenes"],
  additionalProperties: false,
}

const VALID_BODY = {
  system: "You are a production planner.",
  input: "A rainy chase through Rome.",
  jsonSchema: STUDIO_SCHEMA,
}

describe("jsonSchemaDepth", () => {
  it("scalars are 0 and an empty container is 1", () => {
    expect(jsonSchemaDepth("x")).toBe(0)
    expect(jsonSchemaDepth(3)).toBe(0)
    expect(jsonSchemaDepth({})).toBe(1)
    expect(jsonSchemaDepth([])).toBe(1)
  })

  it("counts the deepest nesting, through arrays as well as objects", () => {
    expect(jsonSchemaDepth({ a: { b: 1 } })).toBe(2)
    expect(jsonSchemaDepth({ a: [{ b: 1 }] })).toBe(3)
  })

  it("stops at the limit rather than the stack, so a bomb costs `limit` frames", () => {
    let bomb: unknown = 1
    for (let i = 0; i < 5000; i++) bomb = { a: bomb }
    expect(jsonSchemaDepth(bomb)).toBe(JSON_SCHEMA_MAX_DEPTH + 1)
  })

  it("this studio-shaped fixture measures 13 — comfortably inside the cap", () => {
    // The REAL rendered structural schema measures 11 (pinned on the studio side
    // by src/lib/production-format/__tests__/json-schema.test.ts). This fixture
    // is a hand-written stand-in that is two levels deeper in places; both sit
    // far under the cap, which is the point of choosing 20 over the spec's 8.
    expect(jsonSchemaDepth(STUDIO_SCHEMA)).toBe(13)
    expect(jsonSchemaDepth(STUDIO_SCHEMA)).toBeLessThanOrEqual(JSON_SCHEMA_MAX_DEPTH)
  })
})

describe("digestText", () => {
  it("replaces a big prompt with its digest, size and a 500-char head", () => {
    const digest = digestText("S".repeat(2000))
    expect(digest.chars).toBe(2000)
    expect(digest.head).toHaveLength(500)
    expect(digest.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("a short prompt keeps its whole text as the head", () => {
    expect(digestText("hello").head).toBe("hello")
  })
})

describe("llmStructuredBody", () => {
  it("accepts the studio call shape", () => {
    const result = llmStructuredBody.safeParse(VALID_BODY)
    expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true)
  })

  it("defaults maxRetries to 2", () => {
    const result = llmStructuredBody.safeParse(VALID_BODY)
    expect(result.success && result.data.maxRetries).toBe(2)
  })

  it("rejects an empty input", () => {
    expect(llmStructuredBody.safeParse({ ...VALID_BODY, input: "" }).success).toBe(false)
  })

  it("rejects a jsonSchema that is not an object schema", () => {
    const result = llmStructuredBody.safeParse({ ...VALID_BODY, jsonSchema: { type: "string" } })
    expect(result.success).toBe(false)
    expect(result.success ? "" : result.error.issues[0].message).toContain('type "object"')
  })

  it("rejects a jsonSchema over the serialized byte cap", () => {
    const fat = { type: "object", description: "x".repeat(JSON_SCHEMA_MAX_BYTES) }
    const result = llmStructuredBody.safeParse({ ...VALID_BODY, jsonSchema: fat })
    expect(result.success).toBe(false)
    expect(result.success ? "" : result.error.issues[0].message).toContain("bytes")
  })

  it("rejects a jsonSchema nested past the depth cap", () => {
    let deep: Record<string, unknown> = { type: "object" }
    for (let i = 0; i < JSON_SCHEMA_MAX_DEPTH + 2; i++) deep = { type: "object", properties: { a: deep } }
    const result = llmStructuredBody.safeParse({ ...VALID_BODY, jsonSchema: deep })
    expect(result.success).toBe(false)
    expect(result.success ? "" : result.error.issues[0].message).toContain("levels deep")
  })

  it("rejects a maxTokens above the platform-wide advanced-mode ceiling", () => {
    expect(llmStructuredBody.safeParse({ ...VALID_BODY, maxTokens: 40000 }).success).toBe(false)
  })

  it("strips unknown keys instead of rejecting (workflowId rides the raw body)", () => {
    const result = llmStructuredBody.safeParse({ ...VALID_BODY, workflowId: "wf-1", nodeId: "n-1" })
    expect(result.success).toBe(true)
    expect(result.success && "workflowId" in result.data).toBe(false)
  })
})

describe("convertJsonSchema", () => {
  it("converts the studio structural schema and enforces its concrete keywords", () => {
    const converted = convertJsonSchema(STUDIO_SCHEMA)
    expect("schema" in converted).toBe(true)
    if (!("schema" in converted)) return
    const doc = {
      format: "nodaro-studio-production",
      version: 1,
      scenes: [
        {
          name: "The chase begins",
          look: { atmosphereId: ["fog", "light-rain"] },
          shots: [{ seconds: 4.2, text: "she sprints", picks: { framingId: "wide-shot" }, transition: { id: "cross-dissolve" } }],
        },
      ],
    }
    expect(converted.schema.safeParse(doc).success).toBe(true)
    // const, exclusiveMinimum and multipleOf all survive the conversion.
    expect(converted.schema.safeParse({ ...doc, format: "other" }).success).toBe(false)
    expect(converted.schema.safeParse({ ...doc, scenes: [{ shots: [{ seconds: 0, text: "x" }] }] }).success).toBe(false)
    expect(converted.schema.safeParse({ ...doc, scenes: [{ shots: [{ seconds: 4.15, text: "x" }] }] }).success).toBe(false)
  })

  it("returns an error (never throws) for a keyword zod cannot represent", () => {
    const converted = convertJsonSchema({ type: "object", properties: { a: { not: { type: "string" } } } })
    expect("error" in converted).toBe(true)
    expect("error" in converted && converted.error).toContain("could not be converted")
  })

  it("DOCUMENTED, NOT FIXED: an anyOf of bare 'required' branches converts to an unconstrained branch and is not enforced", () => {
    // The at-least-one-of idiom. `z.fromJSONSchema` accepts it rather than
    // throwing, but turns the bare-`required` branches into a schema that
    // constrains nothing (measured on zod 4.4.3: a ZodIntersection whose union
    // branch accepts `{}`), so the constraint vanishes silently. That is why
    // the route's schema is deliberately WEAKER than the importer's and studio
    // enforces frame/motion/shots itself (design §8). The `safeParse({})`
    // assertion — not the shape of the converted object — is what pins the
    // behaviour across a zod upgrade.
    const converted = convertJsonSchema({
      type: "object",
      properties: { frame: { type: "object" }, motion: { type: "object" }, shots: { type: "array", items: { type: "object" } } },
      anyOf: [{ required: ["frame"] }, { required: ["motion"] }, { required: ["shots"] }],
      additionalProperties: false,
    })
    expect("schema" in converted).toBe(true)
    if (!("schema" in converted)) return
    expect(converted.schema.safeParse({}).success).toBe(true)
  })
})
