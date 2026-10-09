import { GEMINI_ENUM_LIST_LIMIT, GEMINI_ENUM_VALUE_BUDGET, toGeminiResponseSchema, withholdEnumsOverBudget } from "../response-schema.js"
/**
 * What the direct Google lane is told about the SHAPE of a structured answer.
 *
 * Google compiles `responseJsonSchema` into a constrained decoder with a state
 * budget, and an array cap multiplies that budget by its bound. Measured
 * 2026-09-18 against `gemini-3.7-flash`: a schema with nested `maxItems`
 * (32 × 24, plus 48 and 24) is refused outright — a bare
 * `400 INVALID_ARGUMENT` in ~2 s, no usage, no hint at which keyword — while
 * the SAME request with only `maxItems` removed answers in ~7 s and passes the
 * caller's Zod. `maxLength`, `minimum`/`maximum`, `minItems` and the thinking
 * level were each varied alone and are irrelevant. Every scene3d job with a
 * video reference failed on it, three queue attempts each.
 *
 * The cap is not lost by withholding it: `llmCompleteStructured` re-validates
 * every answer against the caller's Zod schema, which still carries it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { z } from "zod"

const generateContent = vi.fn()
const generateContentStream = vi.fn()

vi.mock("../../config.js", () => ({
  config: {
    GEMINI_API_KEY: "test-gemini-key",
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    NODE_ENV: "test",
  },
}))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent, generateContentStream }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))

beforeEach(() => {
  vi.resetModules()
  generateContent.mockReset()
  generateContentStream.mockReset()
})

describe("toGeminiResponseSchema", () => {
  it("withholds every array cap, at any depth, and keeps the rest of the schema", async () => {
    const { toGeminiResponseSchema } = await import("../response-schema.js")
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["subjects"],
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 1000 },
        subjects: {
          type: "array", minItems: 1, maxItems: 32,
          items: {
            type: "object",
            properties: {
              at: { type: "number", minimum: 0, maximum: 60 },
              motion: { type: "array", maxItems: 24, items: { type: "string" } },
            },
          },
        },
        either: { anyOf: [{ type: "array", maxItems: 3, items: { type: "string" } }, { type: "null" }] },
      },
    }

    expect(toGeminiResponseSchema(schema)).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["subjects"],
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 1000 },
        subjects: {
          type: "array", minItems: 1,
          items: {
            type: "object",
            properties: {
              at: { type: "number", minimum: 0, maximum: 60 },
              motion: { type: "array", items: { type: "string" } },
            },
          },
        },
        either: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
      },
    })
  })

  it("keeps a PROPERTY that happens to be named maxItems — that is data, not a keyword", async () => {
    const { toGeminiResponseSchema } = await import("../response-schema.js")
    const schema = {
      type: "object",
      properties: { maxItems: { type: "integer" }, list: { type: "array", maxItems: 5 } },
      required: ["maxItems"],
    }
    expect(toGeminiResponseSchema(schema)).toEqual({
      type: "object",
      properties: { maxItems: { type: "integer" }, list: { type: "array" } },
      required: ["maxItems"],
    })
  })

  it("never mutates the caller's schema — it is also the request's fingerprint", async () => {
    const { toGeminiResponseSchema } = await import("../response-schema.js")
    const schema = { type: "array", maxItems: 4, items: { type: "array", maxItems: 2 } }
    const before = JSON.stringify(schema)
    toGeminiResponseSchema(schema)
    expect(JSON.stringify(schema)).toBe(before)
  })
})

describe("the wire: no array cap reaches Google on either call shape", () => {
  const brief = z.object({
    camera: z.array(z.object({ movement: z.string().max(1000) }).strict()).min(1).max(24),
    subjects: z.array(z.object({
      id: z.string(),
      motion: z.array(z.object({ description: z.string() }).strict()).max(24),
    }).strict()).max(32),
  }).strict()
  const answer = { camera: [{ movement: "dolly in" }], subjects: [] }

  it("llmCompleteStructured on the pinned direct lane", async () => {
    const { llmCompleteStructured } = await import("../../llm-client.js")
    generateContent.mockResolvedValue({
      text: JSON.stringify(answer),
      usageMetadata: { promptTokenCount: 1636, candidatesTokenCount: 883 },
    })

    const result = await llmCompleteStructured({
      modelId: "gemini-3.7-flash", system: "", requireLane: "direct",
      messages: [{ role: "user", content: "analyse" }],
    }, brief, { schemaName: "scene3d_video_reference", maxRetries: 0 })

    expect(result.output).toEqual(answer)
    const sent = generateContent.mock.calls[0]![0] as { config: { responseJsonSchema: unknown } }
    const wire = JSON.stringify(sent.config.responseJsonSchema)
    expect(wire).not.toContain("maxItems")
    // Everything that steers the decoder without multiplying its states stays.
    expect(wire).toContain('"minItems":1')
    expect(wire).toContain('"maxLength":1000')
    expect(wire).toContain('"additionalProperties":false')
  })

  it("the streaming builder shares the same config", async () => {
    const { llmStream } = await import("../../llm-client.js")
    generateContentStream.mockResolvedValue((async function* () {
      yield { text: "{}", usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }
    })())

    await llmStream({
      modelId: "gemini-3.7-flash", system: "", requireLane: "direct",
      messages: [{ role: "user", content: "analyse" }],
      jsonSchema: { name: "x", schema: { type: "array", maxItems: 9, items: { type: "string" } } },
    }, () => {})

    const sent = generateContentStream.mock.calls[0]![0] as { config: { responseJsonSchema: unknown } }
    expect(sent.config.responseJsonSchema).toEqual({ type: "array", items: { type: "string" } })
  })
})

describe("the enum-value budget", () => {
  const enumOf = (n: number, prefix = "v") => ({ type: "string", enum: Array.from({ length: n }, (_, i) => `${prefix}${i}`) })

  it("withholds whole enum lists, largest first, until the total fits — a withheld list leaves a plain string", () => {
    const schema = {
      type: "object",
      properties: { a: enumOf(50, "a"), b: enumOf(30, "b"), c: { type: "array", items: enumOf(40, "c") }, d: enumOf(5, "d") },
    }
    const out = withholdEnumsOverBudget(structuredClone(schema), 60) as typeof schema
    // 125 > 60: drop a (75 left), drop c (35 left) — b and d stay.
    expect(out.properties.a).toEqual({ type: "string" })
    expect(out.properties.c.items).toEqual({ type: "string" })
    expect(out.properties.b.enum).toHaveLength(30)
    expect(out.properties.d.enum).toHaveLength(5)
  })

  it("leaves a schema within budget untouched", () => {
    const schema = { type: "object", properties: { a: enumOf(10), b: enumOf(20) } }
    expect(withholdEnumsOverBudget(structuredClone(schema), 30)).toEqual(schema)
  })

  it("a property NAMED enum is data, not an enum list", () => {
    const schema = { type: "object", properties: { enum: { type: "array", items: { type: "string" } }, kind: enumOf(5) } }
    expect(withholdEnumsOverBudget(structuredClone(schema), 1)).toEqual({
      type: "object",
      properties: { enum: { type: "array", items: { type: "string" } }, kind: { type: "string" } },
    })
  })

  it("a list longer than the per-list cap is withheld even when the total is under budget", () => {
    const schema = { type: "object", properties: { big: enumOf(150, "b"), small: enumOf(10, "s") } }
    const out = withholdEnumsOverBudget(structuredClone(schema), 700, 100) as typeof schema
    expect(out.properties.big).toEqual({ type: "string" })
    expect(out.properties.small.enum).toHaveLength(10)
  })

  it("toGeminiResponseSchema caps the person picker's `type` list on its own — the schema is under budget", async () => {
    const { buildMultiPickerAnalyzerSpec } = await import("@nodaro/prompts")
    const { z } = await import("zod")
    const spec = buildMultiPickerAnalyzerSpec(["person"])
    const schema = z.toJSONSchema(spec.schema, { target: "draft-7", unrepresentable: "any", io: "input" }) as Record<string, unknown>
    const largest = (node: unknown): number => {
      if (Array.isArray(node)) return Math.max(0, ...node.map(largest))
      if (!node || typeof node !== "object") return 0
      const obj = node as Record<string, unknown>
      let n = Array.isArray(obj.enum) ? obj.enum.length : 0
      for (const [k, v] of Object.entries(obj)) if (k !== "enum" && v && typeof v === "object") n = Math.max(n, k === "properties" ? Math.max(0, ...Object.values(v as object).map(largest)) : largest(v))
      return n
    }
    expect(largest(schema)).toBeGreaterThan(GEMINI_ENUM_LIST_LIMIT)
    expect(largest(toGeminiResponseSchema(schema))).toBeLessThanOrEqual(GEMINI_ENUM_LIST_LIMIT)
  })

  it("toGeminiResponseSchema applies the measured budget to the five-picker analyzer schema", async () => {
    const { buildMultiPickerAnalyzerSpec } = await import("@nodaro/prompts")
    const { z } = await import("zod")
    const spec = buildMultiPickerAnalyzerSpec(["person", "styling", "held-prop", "material", "animal"])
    const schema = z.toJSONSchema(spec.schema, { target: "draft-7", unrepresentable: "any", io: "input" }) as Record<string, unknown>
    const total = (node: unknown): number => {
      if (Array.isArray(node)) return node.reduce<number>((n, x) => n + total(x), 0)
      if (!node || typeof node !== "object") return 0
      const obj = node as Record<string, unknown>
      let n = Array.isArray(obj.enum) ? obj.enum.length : 0
      for (const [k, v] of Object.entries(obj)) if (k !== "enum" && v && typeof v === "object") n += k === "properties" ? Object.values(v as object).reduce<number>((m, x) => m + total(x), 0) : total(v)
      return n
    }
    expect(total(schema)).toBeGreaterThan(GEMINI_ENUM_VALUE_BUDGET)
    expect(total(toGeminiResponseSchema(schema))).toBeLessThanOrEqual(GEMINI_ENUM_VALUE_BUDGET)
  })
})
