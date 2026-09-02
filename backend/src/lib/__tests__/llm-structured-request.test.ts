/**
 * The pre-flight both structured routes and the worker share. The sync
 * route's own test file proves the route still behaves; this file pins the
 * helpers' decision table so a change to one caller cannot drift the others.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ llmCompleteStructured: vi.fn() }))
vi.mock("../config.js", () => ({
  config: { EDITION: "cloud", ANTHROPIC_API_KEY: "k", KIE_API_KEY: "" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("../llm-client.js", () => ({ llmCompleteStructured: mocks.llmCompleteStructured }))

import { LLM_FEATURE_DEFAULTS, getLlmModel } from "@nodaro/shared"
import {
  llmStructuredBody,
  prepareStructuredRequest,
  runStructuredCompletion,
  structuredJobInputData,
  STRUCTURED_LLM_TIMEOUT_MS,
} from "../llm-structured-request.js"

const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false }
const body = (extra: Record<string, unknown> = {}) =>
  llmStructuredBody.parse({ system: "You plan productions.", input: "A rainy chase through Rome.", jsonSchema: SCHEMA, ...extra })

beforeEach(() => vi.clearAllMocks())

describe("prepareStructuredRequest", () => {
  it("defaults the model to the generic llm-chat default and prices under llm-structured", () => {
    const out = prepareStructuredRequest(body())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.model.id).toBe(LLM_FEATURE_DEFAULTS["llm-chat"])
    expect(out.modelIdentifier.startsWith("llm-structured")).toBe(true)
    expect(out.schema.safeParse({ title: "x" }).success).toBe(true)
    expect(out.schema.safeParse({}).success).toBe(false)
  })
  it("refuses an unknown model, an over-cap maxTokens, and an unconvertible schema — all 400", () => {
    // llmStructuredBody's enum already rejects unknown ids; the helper's own
    // guard is reached through a body built around it.
    const unknown = { ...body(), llmModel: "no-such-model" } as ReturnType<typeof body>
    expect(prepareStructuredRequest(unknown)).toMatchObject({ ok: false, status: 400, error: { code: "validation_error", message: "Unknown llmModel" } })

    // gemini-3.6-flash caps output at 8192 (the sync route test uses the same
    // pair); 16384 clears the body schema's 32768 ceiling and trips the model cap.
    expect(getLlmModel("gemini-3.6-flash")!.maxOutputTokens).toBeLessThan(16384)
    const over = prepareStructuredRequest(body({ llmModel: "gemini-3.6-flash", maxTokens: 16384 }))
    expect(over).toMatchObject({ ok: false, status: 400 })
    if (!over.ok) expect(over.error.message).toContain("exceeds")

    const bad = prepareStructuredRequest(body({ jsonSchema: { type: "object", properties: { a: { not: { type: "string" } } } } }))
    expect(bad).toMatchObject({ ok: false, status: 400, error: { code: "validation_error" } })
  })
})

describe("runStructuredCompletion", () => {
  it("runs the exact call the sync route ran: model id, system, one user turn, timeout, retries, schemaName, caller maxTokens outside Advanced mode", async () => {
    mocks.llmCompleteStructured.mockResolvedValue({ output: { title: "Rain" }, inputTokens: 10, outputTokens: 5 })
    const b = body({ maxTokens: 2048, schemaName: "studio_production", maxRetries: 1 })
    const prepared = prepareStructuredRequest(b)
    if (!prepared.ok) throw new Error("unexpected")
    const out = await runStructuredCompletion(b, prepared, "COMPOSED INPUT")
    expect(out.output).toEqual({ title: "Rain" })
    const [req, schema, opts] = mocks.llmCompleteStructured.mock.calls[0]
    expect(req).toMatchObject({
      modelId: prepared.model.id,
      system: "You plan productions.",
      messages: [{ role: "user", content: "COMPOSED INPUT" }],
      timeoutMs: STRUCTURED_LLM_TIMEOUT_MS,
      maxTokens: 2048,
    })
    expect(schema).toBe(prepared.schema)
    expect(opts).toEqual({ schemaName: "studio_production", maxRetries: 1 })
  })
})

describe("structuredJobInputData", () => {
  it("stores a digest of the system prompt and the schema's name+bytes, never the texts", () => {
    const stored = structuredJobInputData(body({ schemaName: "studio_production", origin: "studio" }))
    expect(stored.type).toBe("llm-structured")
    expect(stored.origin).toBe("studio")
    expect(stored.input).toBe("A rainy chase through Rome.")
    expect(stored.system).toMatchObject({ chars: "You plan productions.".length })
    expect((stored.system as { sha256: string }).sha256).toHaveLength(64)
    expect(stored.jsonSchema).toEqual({ name: "studio_production", bytes: Buffer.byteLength(JSON.stringify(SCHEMA), "utf8") })
  })
})
