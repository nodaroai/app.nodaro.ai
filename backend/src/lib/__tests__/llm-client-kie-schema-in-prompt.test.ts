/**
 * Gemini 3.8 Flash on its KIE lane (and 3.7 Flash, which KIE serves from the
 * same endpoint) sends a structured call NO `response_format`: since
 * 2026-11-13 that endpoint answers any request carrying one with an in-band
 * `{"code":500}`. The schema rides the system prompt instead
 * (`kieSchemaInPrompt`), in the wire form that field sent, and the answer is
 * put back under the caller's names, parsed, validated and re-asked as any
 * untrusted one. Every other model's wire is unchanged; the direct lane's
 * enforced `responseJsonSchema` is covered in gemini/__tests__/response-schema.test.ts,
 * and its one last-resort ask in llm-kie-chat-prompt-json-direct-backup.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"
import { getLlmModel, llmSendsSchema, STRUCTURED_VISION_MODELS } from "@nodaro/shared/llm-models"

vi.mock("../config.js", () => ({
  config: { KIE_API_KEY: "test-kie-key", KIE_API_BASE_URL: "https://api.kie.ai", NODE_ENV: "test" },
  hasCredits: () => false,
}))

const { llmComplete, llmStream, llmCompleteStructured, structuredJsonSchema } = await import("../llm-client.js")
const { requestChars } = await import("../llm/kie-cost.js")
const { kieChatPromptJsonFormat, kiePromptJsonSystem, kieWireSchema } = await import("../llm/structured-schema.js")

const URL_38 = "https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions"
const schema = { type: "object", properties: { mood: { type: "string", enum: ["happy", "sad"] } }, required: ["mood"] }
const flash38 = getLlmModel("gemini-3.8-flash")!

/** A picker-shaped answer: a dimension named `type` (a keyword to KIE's validator)
 *  and one list of 150 ids, over the 100 Google's decoder takes in one list. */
const SHADES = Array.from({ length: 150 }, (_, i) => `shade-${i}`)
const Subject = z.object({ subject: z.object({ type: z.enum(["woman", "man"]), shade: z.enum(SHADES as [string, ...string[]]) }).strict() }).strict()
const wideSchema = structuredJsonSchema(Subject)

function chatOk(content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }): Response {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content } }],
    usage,
  }), { status: 200, headers: { "Content-Type": "application/json" } })
}
function sse(lines: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(new TextEncoder().encode(l))
      c.close()
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

let fetchMock: ReturnType<typeof vi.fn>
const bodyOf = (call = 0) => JSON.parse((fetchMock.mock.calls[call]?.[1] as { body: string }).body) as Record<string, any>
const systemOf = (call = 0) => (bodyOf(call).messages as Array<{ role: string; content: unknown }>).find((m) => m.role === "system")?.content

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("3.8 / 3.7 Flash on KIE: the schema in the prompt, no response_format", () => {
  it.each(["gemini-3.8-flash", "gemini-3.7-flash"])("%s: a structured call sends no response_format; the schema follows the caller's system prompt", async (modelId) => {
    fetchMock.mockResolvedValue(chatOk('{"mood":"happy"}'))
    await llmComplete({ modelId, system: "be terse", requireLane: "kie", messages: [{ role: "user", content: "x" }], jsonSchema: { name: "r", schema } })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(URL_38)
    expect(bodyOf()).not.toHaveProperty("response_format")
    const system = systemOf() as string
    expect(system.startsWith("be terse\n\nReply with ONLY one JSON object — the `r` result")).toBe(true)
    expect(system).toContain(JSON.stringify(schema))
  })

  it.each(["gemini-3.8-flash", "gemini-3.7-flash"])("%s: a call with no schema is unchanged — no response_format, the caller's system prompt", async (modelId) => {
    fetchMock.mockResolvedValue(chatOk("hello"))
    const res = await llmComplete({ modelId, system: "be terse", requireLane: "kie", messages: [{ role: "user", content: "x" }] })
    expect(bodyOf()).not.toHaveProperty("response_format")
    expect(systemOf()).toBe("be terse")
    expect(res.text).toBe("hello")
  })

  it("a fenced answer comes back as its JSON", async () => {
    fetchMock.mockResolvedValue(chatOk('```json\n{"mood":"sad"}\n```'))
    const res = await llmComplete({ modelId: "gemini-3.8-flash", system: "", requireLane: "kie", messages: [{ role: "user", content: "x" }], jsonSchema: { name: "r", schema } })
    expect(res.text).toBe('{"mood":"sad"}')
  })

  it("the streamed twin sends the same: no response_format, the schema in the system prompt", async () => {
    fetchMock.mockResolvedValue(sse([
      'data: {"choices":[{"delta":{"content":"{\\"mood\\":"}}]}\n',
      'data: {"choices":[{"delta":{"content":"\\"happy\\"}"}}]}\n',
      "data: [DONE]\n",
    ]))
    const res = await llmStream(
      { modelId: "gemini-3.8-flash", system: "be terse", requireLane: "kie", messages: [{ role: "user", content: "x" }], jsonSchema: { name: "r", schema } },
      () => {},
    )
    expect(bodyOf().stream).toBe(true)
    expect(bodyOf()).not.toHaveProperty("response_format")
    expect(systemOf()).toContain(JSON.stringify(schema))
    expect(res.text).toBe('{"mood":"happy"}')
  })

  it("an off-schema answer is still caught and re-asked; every attempt goes without response_format", async () => {
    const Mood = z.object({ mood: z.enum(["happy", "sad"]) }).strict()
    fetchMock
      .mockResolvedValueOnce(chatOk('{"mood":"cheerful and energized"}', { prompt_tokens: 40, completion_tokens: 9 }))
      .mockResolvedValueOnce(chatOk('{"mood":"happy"}', { prompt_tokens: 60, completion_tokens: 5 }))
    const out = await llmCompleteStructured(
      { modelId: "gemini-3.8-flash", system: "Answer as JSON.", requireLane: "kie", messages: [{ role: "user", content: "How does a sunny morning feel?" }] },
      Mood,
    )
    expect(out.output).toEqual({ mood: "happy" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const call of [0, 1]) {
      expect(fetchMock.mock.calls[call]?.[0]).toBe(URL_38)
      expect(bodyOf(call)).not.toHaveProperty("response_format")
      expect(systemOf(call)).toContain('"enum":["happy","sad"]')
    }
    // The re-ask carries the bad answer and a correction turn.
    const second = bodyOf(1).messages as Array<{ role: string; content: unknown }>
    expect(JSON.stringify(second)).toContain("cheerful and energized")
    expect(second.at(-1)?.role).toBe("user")
    expect(out.attempts.map((a) => a.lane)).toEqual(["kie", "kie"])
  })

  // The media fail-open guard: the schema text in the prompt adds prompt tokens
  // even to a reply that never saw the media, so the floor rises by them.
  it("the media floor rises by the schema text the prompt now carries, at 4 characters a token; other models' floor is unchanged", async () => {
    const floor = 9_000
    const req = (modelId: string) => ({
      modelId, system: "analyse the clip", requireLane: "kie" as const, minPromptTokens: floor,
      messages: [{ role: "user" as const, content: "x" }], jsonSchema: { name: "r", schema },
    })
    const added = kieChatPromptJsonFormat(flash38, req("gemini-3.8-flash"))!.system.length - "analyse the clip".length
    const raised = floor + Math.floor(added / 4)
    // 4, not 5: at 5 the raise would be smaller and the guard weaker.
    expect(raised).toBeGreaterThan(floor + Math.floor(added / 5))
    expect(raised).toBeGreaterThan(floor)
    // Just above the caller's floor, below the raised one: a media-less reply on 3.8.
    fetchMock.mockResolvedValue(chatOk('{"mood":"happy"}', { prompt_tokens: floor + 1, completion_tokens: 5 }))
    await expect(llmComplete(req("gemini-3.8-flash"))).rejects.toThrow(/media_not_ingested/)
    // One token short of it is refused — where a 5-characters-a-token raise would have let it through.
    fetchMock.mockResolvedValue(chatOk('{"mood":"happy"}', { prompt_tokens: raised - 1, completion_tokens: 5 }))
    await expect(llmComplete(req("gemini-3.8-flash"))).rejects.toThrow(/media_not_ingested/)
    // At the raised floor it passes.
    fetchMock.mockResolvedValue(chatOk('{"mood":"happy"}', { prompt_tokens: raised, completion_tokens: 5 }))
    await expect(llmComplete(req("gemini-3.8-flash"))).resolves.toMatchObject({ text: '{"mood":"happy"}' })
    // A model that sends response_format keeps the caller's floor exactly.
    fetchMock.mockResolvedValue(chatOk('{"mood":"happy"}', { prompt_tokens: floor + 1, completion_tokens: 5 }))
    await expect(llmComplete(req("gemini-3.6-flash"))).resolves.toMatchObject({ text: '{"mood":"happy"}' })
  })

  // The raise follows the compact schema the prompt carries, not the caller's:
  // a floor raised by the full schema would reject a reply that read the media.
  it("on a wide schema the floor rises by the compact text, not the caller's full schema", async () => {
    const floor = 9_000
    const req = {
      modelId: "gemini-3.8-flash", system: "analyse", requireLane: "kie" as const, minPromptTokens: floor,
      messages: [{ role: "user" as const, content: "x" }], jsonSchema: { name: "r", schema: wideSchema },
    }
    const compact = Math.floor((kieChatPromptJsonFormat(flash38, req)!.system.length - "analyse".length) / 4)
    const full = Math.floor((kiePromptJsonSystem("analyse", { name: "r", schema: wideSchema }).length - "analyse".length) / 4)
    expect(full).toBeGreaterThan(compact)
    fetchMock.mockResolvedValue(chatOk('{"subject":{"type_":"woman","shade":"shade-3"}}', { prompt_tokens: floor + compact, completion_tokens: 5 }))
    await expect(llmComplete(req)).resolves.toMatchObject({ text: '{"subject":{"type":"woman","shade":"shade-3"}}' })
  })

  it("its trust is unchanged: still a structured model, and a request's size counts the schema as it is sent", () => {
    expect(STRUCTURED_VISION_MODELS.map((m) => m.id)).toContain("gemini-3.8-flash")
    expect(llmSendsSchema("gemini-3.8-flash")).toBe(true)
    const req = { modelId: "gemini-3.8-flash", system: "abc", messages: [{ role: "user" as const, content: "x" }], jsonSchema: { name: "r", schema } }
    // The system prompt sent (the caller's, the one-object rule, the schema) and the message.
    expect(requestChars(req)).toBe(kieChatPromptJsonFormat(flash38, req)!.system.length + 1)
    expect(requestChars(req)).toBeGreaterThan(3 + 1 + JSON.stringify(schema).length)
  })
})

// The prompt carries the form the old `response_format` path sent the same
// endpoint (`kieWireSchema`), not the caller's full schema: a describe-to-picker
// read's catalog is in its legend already, and the compact form leaves out the
// lists over Google's budget.
describe("3.8 Flash on KIE: the prompt carries the schema's wire form", () => {
  it("a keyword-named property goes under its wire name, a list over Google's budget is left out, and the answer comes back under the caller's names and validates", async () => {
    fetchMock.mockResolvedValue(chatOk('```json\n{"subject":{"type_":"woman","shade":"shade-140"}}\n```'))
    const out = await llmCompleteStructured(
      { modelId: "gemini-3.8-flash", system: "Read the photo.", requireLane: "kie", messages: [{ role: "user", content: "x" }] },
      Subject,
      { schemaName: "picker" },
    )
    expect(out.output).toEqual({ subject: { type: "woman", shade: "shade-140" } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const system = systemOf() as string
    const wire = kieWireSchema({ name: "picker", schema: wideSchema }, flash38).schema
    expect(system).toBe(kiePromptJsonSystem("Read the photo.", { name: "picker", schema: wire }))
    expect(system).toContain('"type_"')
    expect(system).not.toContain("shade-140")
    expect(system).not.toContain(JSON.stringify(wideSchema))
    expect(bodyOf()).not.toHaveProperty("response_format")
  })

  it("the streamed twin restores the caller's names on its text", async () => {
    fetchMock.mockResolvedValue(sse([
      'data: {"choices":[{"delta":{"content":"{\\"subject\\":{\\"type_\\":"}}]}\n',
      'data: {"choices":[{"delta":{"content":"\\"man\\",\\"shade\\":\\"shade-1\\"}}"}}]}\n',
      "data: [DONE]\n",
    ]))
    const res = await llmStream(
      { modelId: "gemini-3.8-flash", system: "", requireLane: "kie", messages: [{ role: "user", content: "x" }], jsonSchema: { name: "picker", schema: wideSchema } },
      () => {},
    )
    expect(res.text).toBe('{"subject":{"type":"man","shade":"shade-1"}}')
  })
})

describe("every other model's KIE wire is unchanged", () => {
  it.each([
    ["gemini-3.6-flash", "https://api.kie.ai/gemini-3-6-flash-openai/v1/chat/completions"],
    ["gemini-3.1-pro", "https://api.kie.ai/gemini-3.1-pro/v1/chat/completions"],
    ["gemini-4-carbon", "https://api.kie.ai/gemini-4-carbon-openai/v1/chat/completions"],
  ])("%s still sends its schema as response_format, and the caller's system prompt as it is", async (modelId, url) => {
    fetchMock.mockResolvedValue(chatOk('{"mood":"happy"}'))
    await llmComplete({ modelId, system: "be terse", requireLane: "kie", messages: [{ role: "user", content: "x" }], jsonSchema: { name: "r", schema } })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url)
    expect(bodyOf().response_format).toMatchObject({ type: "json_schema", json_schema: { name: "r", strict: false } })
    expect(JSON.stringify(bodyOf().response_format)).toContain('"enum":["happy","sad"]')
    expect(systemOf()).toBe("be terse")
  })
})
