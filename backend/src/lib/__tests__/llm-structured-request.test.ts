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
  convertJsonSchema,
  llmStructuredBody,
  prepareStructuredRequest,
  renderProviderSchema,
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

describe("llmStructuredBody — a root combinator is refused before anything is spent", () => {
  /**
   * A top-level `anyOf` / `oneOf` / `allOf` cannot be served: the Anthropic
   * tool lane refuses it outright (`input_schema does not support oneOf, allOf,
   * or anyOf at the top level`, measured 2026-09-10), and the route's own Zod
   * round trip renders it back as a type-less `allOf` that every lane rejects
   * (`tools.0.custom.input_schema.type: Field required`). Until 2026-09-10 such
   * a schema passed the `type: "object"` check, reserved credits, 400'd on the
   * direct lane, fell back to KIE and burned three attempts on garbage — the
   * Studio Director outage. Refuse it here, where nothing has been spent.
   */
  it.each(["anyOf", "oneOf", "allOf"])("400s a schema carrying %s at the top level", (keyword) => {
    const schema = { ...SCHEMA, [keyword]: [{ required: ["title"] }] }
    const parsed = llmStructuredBody.safeParse({ system: "s", input: "i", jsonSchema: schema })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues.map((i) => i.message).join(" ")).toContain("top level")
  })
  it("prepareStructuredRequest refuses the same thing spelled through a root $ref — the check the worker re-runs", () => {
    // The body rule reads root keys; a `$ref` into a `$defs` combinator has none
    // of them and converts fine, yet renders for the provider without a `type`.
    // `prepareStructuredRequest` judges the RENDERED schema, and the worker
    // re-runs it, so a job enqueued before the body rule fails with this sentence.
    const viaRef = { type: "object", $ref: "#/$defs/doc", $defs: { doc: { anyOf: [{ ...SCHEMA, properties: { title: { type: "string" } } }, { ...SCHEMA, properties: { name: { type: "string" } } }] } } }
    const parsed = llmStructuredBody.safeParse({ system: "s", input: "i", jsonSchema: viaRef })
    if (parsed.success) {
      const out = prepareStructuredRequest(parsed.data)
      expect(out).toMatchObject({ ok: false, status: 400, error: { code: "validation_error" } })
      if (!out.ok) expect(out.error.message).toContain("object schema")
    } else {
      // zod refused the spelling at the body already — also a refusal before spend.
      expect(parsed.success).toBe(false)
    }
  })
  it("renderProviderSchema is the provider's view: a root combinator renders type-less, a plain root stays an object", () => {
    const plain = convertJsonSchema(SCHEMA)
    expect("schema" in plain).toBe(true)
    if ("schema" in plain) expect(renderProviderSchema(plain.schema).type).toBe("object")
    const combinator = convertJsonSchema({ ...SCHEMA, anyOf: [{ required: ["title"] }, { required: ["title"] }] })
    expect("schema" in combinator).toBe(true)
    if ("schema" in combinator) expect(renderProviderSchema(combinator.schema).type).toBeUndefined()
  })
  it("still accepts the same combinators BELOW the root", () => {
    const schema = { ...SCHEMA, properties: { title: { anyOf: [{ type: "string" }, { type: "number" }] } } }
    expect(llmStructuredBody.safeParse({ system: "s", input: "i", jsonSchema: schema }).success).toBe(true)
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
