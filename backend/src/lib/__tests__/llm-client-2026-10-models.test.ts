import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", KIE_API_BASE_URL: "https://api.kie.ai", ANTHROPIC_API_KEY: "test-anthropic-key", NODE_ENV: "test" },
}))
const createSpy = vi.fn()
const streamSpy = vi.fn()
vi.mock("../anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: createSpy, stream: streamSpy } }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}
const responsesOk = () =>
  jsonResponse({
    output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
    usage: { input_tokens: 5, output_tokens: 1 },
  })

/** A schema carrying every keyword Anthropic's strict tool mode refuses. */
const CAPPED_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 80 },
    beats: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 12 },
    score: { type: "number", minimum: 0, maximum: 10 },
  },
  required: ["title", "beats", "score"],
}

describe("KIE responses family path for the 2026-10 vendors", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn().mockResolvedValue(responsesOk()); vi.stubGlobal("fetch", fetchMock) })
  afterEach(() => { vi.unstubAllGlobals() })

  it.each([
    ["kimi-k3", "https://api.kie.ai/openai/v1/responses", "kimi-k3"],
    ["deepseek-v4.1-flash", "https://api.kie.ai/openai/v1/responses", "deepseek-v4-1-flash"],
    ["gpt-6-sol", "https://api.kie.ai/codex/v1/responses", "gpt-6-sol"],
    ["gpt-6.1-sol", "https://api.kie.ai/codex/v1/responses", "gpt-6-1-sol"],
    ["grok-4.7", "https://api.kie.ai/grok/v1/responses", "grok-4-7"],
  ])("%s posts to its family path with its KIE slug and no sampling params", async (modelId, url, slug) => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({ modelId, system: "be terse", messages: [{ role: "user", content: "hi" }], temperature: 0.2 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url)
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body)
    expect(body.model).toBe(slug)
    expect(body.stream).toBe(false)
    expect(body.temperature).toBeUndefined()
  })

  it("a `none` request on gpt-6.1-sol sends no reasoning param (the level is not offered)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({ modelId: "gpt-6.1-sol", system: "", messages: [{ role: "user", content: "hi" }], reasoningEffort: "none" })
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body)
    expect(body.reasoning).toBeUndefined()
  })
})

// These calls carry an effort, which serves them on the DIRECT lane (KIE ignores
// Claude effort); the KIE body is pinned in its own case below.
describe("Claude 5.5 structured output — auto tool choice + strict tool (forced choice is a 400)", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    createSpy.mockReset().mockResolvedValue({
      content: [{ type: "text", text: "Here it is." }, { type: "tool_use", name: "r", input: { ok: true } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it.each(["claude-sonnet-5.5", "claude-opus-5.5"])("%s: auto choice, strict tool, withheld caps, instruction appended", async (modelId) => {
    const { llmComplete } = await import("../llm-client.js")
    const res = await llmComplete({
      modelId,
      system: "You are a planner.",
      messages: [{ role: "user", content: "plan" }],
      reasoningEffort: "low",
      jsonSchema: { name: "r", schema: CAPPED_SCHEMA },
    })
    const body = createSpy.mock.calls[0][0] as Record<string, unknown>
    expect(body.tool_choice).toEqual({ type: "auto" })
    const tool = (body.tools as Array<Record<string, unknown>>)[0]
    expect(tool.name).toBe("r")
    expect(tool.strict).toBe(true)
    const schema = tool.input_schema as Record<string, Record<string, Record<string, unknown>>>
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.title).toEqual({ type: "string" })
    expect(schema.properties.beats).toEqual({ type: "array", items: { type: "string" } })
    expect(schema.properties.score).toEqual({ type: "number" })
    expect(body.system).toMatch(/^You are a planner\.\n\nRespond by calling the `r` tool exactly once/)
    expect(body.temperature).toBeUndefined()
    // The caller's schema object is never mutated by the wire sanitizer.
    expect(CAPPED_SCHEMA.properties.title.maxLength).toBe(80)
    // A tool call is the answer even when the model said a sentence first.
    expect(res.text).toBe(JSON.stringify({ ok: true }))
  })

  it("a map-shaped schema goes without `strict` (strict mode cannot carry it)", async () => {
    const { llmComplete } = await import("../llm-client.js")
    const mapSchema = { type: "object", properties: { looks: { type: "object", additionalProperties: { type: "string" } } } }
    await llmComplete({ modelId: "claude-opus-5.5", system: "", messages: [{ role: "user", content: "x" }], reasoningEffort: "low", jsonSchema: { name: "r", schema: mapSchema } })
    const tool = ((createSpy.mock.calls[0][0] as Record<string, unknown>).tools as Array<Record<string, unknown>>)[0]
    expect(tool.strict).toBeUndefined()
    expect(tool.input_schema).toEqual(mapSchema)
    expect((createSpy.mock.calls[0][0] as Record<string, unknown>).tool_choice).toEqual({ type: "auto" })
  })

  it("an answer given as text instead of a tool call is returned as the text", async () => {
    const { llmComplete } = await import("../llm-client.js")
    createSpy.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }], usage: { input_tokens: 1, output_tokens: 1 } })
    const res = await llmComplete({ modelId: "claude-sonnet-5.5", system: "", messages: [{ role: "user", content: "x" }], reasoningEffort: "low", jsonSchema: { name: "r", schema: { type: "object" } } })
    expect(res.text).toBe('{"ok":true}')
  })

  it("an older Claude asked without an effort still gets the forced tool, unchanged", async () => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({ modelId: "claude-opus-5", system: "sys", messages: [{ role: "user", content: "x" }], requireLane: "direct", jsonSchema: { name: "r", schema: CAPPED_SCHEMA } })
    const body = createSpy.mock.calls[0][0] as Record<string, unknown>
    expect(body.tool_choice).toEqual({ type: "tool", name: "r" })
    expect(body.system).toBe("sys")
    expect(body.thinking).toBeUndefined()
    const tool = (body.tools as Array<Record<string, unknown>>)[0]
    expect(tool.strict).toBeUndefined()
    expect(tool.input_schema).toBe(CAPPED_SCHEMA)
  })

  // A forced tool choice suppresses adaptive thinking on Claude Fable 5 — measured
  // 2026-10-09: at high and max the answer came back with no thinking block, in
  // the same time as a no-effort call — so an effort-bearing structured call
  // leaves the choice to the model, the same shape the 5.5 generation is sent.
  it("a forced-choice Claude asked WITH an effort is sent the auto choice, the instruction and the effort", async () => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({ modelId: "claude-fable-5", system: "sys", messages: [{ role: "user", content: "x" }], reasoningEffort: "max", jsonSchema: { name: "r", schema: CAPPED_SCHEMA } })
    const body = createSpy.mock.calls[0][0] as Record<string, unknown>
    expect(body.model).toBe("claude-fable-5")
    expect(body.tool_choice).toEqual({ type: "auto" })
    expect(body.system).toMatch(/^sys\n\nRespond by calling the `r` tool exactly once/)
    expect(body.thinking).toEqual({ type: "adaptive" })
    expect(body.output_config).toEqual({ effort: "max" })
    const tool = (body.tools as Array<Record<string, unknown>>)[0]
    expect(tool.strict).toBe(true)
    expect((tool.input_schema as Record<string, unknown>).additionalProperties).toBe(false)
  })

  it("the direct request goes to the Anthropic id, with an effort when asked", async () => {
    const { llmComplete } = await import("../llm-client.js")
    await llmComplete({ modelId: "claude-opus-5.5", system: "", messages: [{ role: "user", content: "x" }], reasoningEffort: "high", jsonSchema: { name: "r", schema: { type: "object" } } })
    const body = createSpy.mock.calls[0][0] as Record<string, unknown>
    expect(body.model).toBe("claude-opus-5-5")
    expect(body.thinking).toEqual({ type: "adaptive" })
    expect(body.output_config).toEqual({ effort: "high" })
  })

  it("the KIE lane (no effort) sends the same auto choice + strict tool", async () => {
    const { llmComplete } = await import("../llm-client.js")
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(c) {
        const e = new TextEncoder()
        c.enqueue(e.encode('data: {"type":"content_block_start","content_block":{"type":"tool_use","name":"r"}}\n'))
        c.enqueue(e.encode('data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"ok\\":true}"}}\n'))
        c.enqueue(e.encode('data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n'))
        c.close()
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } }))
    const res = await llmComplete({ modelId: "claude-opus-5.5", system: "sys", messages: [{ role: "user", content: "x" }], jsonSchema: { name: "r", schema: CAPPED_SCHEMA } })
    expect(createSpy).not.toHaveBeenCalled()
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body)
    expect(body.model).toBe("claude-opus-5-5")
    expect(body.tool_choice).toEqual({ type: "auto" })
    expect(body.tools[0].strict).toBe(true)
    expect(body.system).toMatch(/Respond by calling the `r` tool/)
    expect(res.text).toBe('{"ok":true}')
  })
})
