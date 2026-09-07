import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
vi.mock("../config.js", () => ({ config: { KIE_API_KEY: "test", KIE_API_BASE_URL: "https://api.kie.ai", NODE_ENV: "test" } }))
vi.mock("../anthropic.js", () => ({ getAnthropicClient: () => ({}) }))
import { llmCompleteStructured, StructuredLlmError } from "../llm-client.js"
import { completeStructuredMetered } from "../private-plugins/llm-metered.js"
const request = { modelId: "gemini-3-flash", system: "", messages: [{ role: "user" as const, content: "Return a value" }] }
const schema = z.object({ value: z.number() })
function response(text: string) {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }), { headers: { "content-type": "application/json" } })
}
afterEach(() => vi.unstubAllGlobals())
describe("structured usage on failed attempts", () => {
  it("returns accumulated usage when every response fails validation", async () => {
    const fetch = vi.fn(async () => response("invalid"))
    vi.stubGlobal("fetch", fetch)
    const error = await llmCompleteStructured(request, schema, { maxRetries: 1 }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(StructuredLlmError)
    expect(error).toMatchObject({ usage: { inputTokens: 24, outputTokens: 6, complete: true } })
    expect((error as StructuredLlmError).usage.providerCost).toBeGreaterThan(0)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("keeps known usage and labels an ambiguous later transport failure incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("invalid")).mockRejectedValue(new Error("socket closed")))
    const error = await llmCompleteStructured(request, schema, { maxRetries: 1 }).catch((error: unknown) => error)
    expect(error).toMatchObject({ usage: { inputTokens: 12, outputTokens: 3, complete: false } })
    expect((error as StructuredLlmError).usage.providerCost).toBeGreaterThan(0)
  })
  it("includes failed parsing attempts in a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response("invalid")).mockResolvedValueOnce(response('{"value":4}')))
    expect(await llmCompleteStructured(request, schema, { maxRetries: 1 })).toMatchObject({ output: { value: 4 }, inputTokens: 24, outputTokens: 6, usageComplete: true })
  })
  it("exposes a metered failure without hidden retries or implicit direct lane", async () => {
    const fetch = vi.fn(async () => response("invalid"))
    vi.stubGlobal("fetch", fetch)
    const result = await completeStructuredMetered({ model: "gemini-3-flash", messages: [{ role: "user", content: [{ type: "text", text: "Return a value" }] }] }, schema)
    expect(result).toMatchObject({ ok: false, usage: { inputTokens: 12, outputTokens: 3, complete: true } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
