/**
 * A Claude call pinned to the direct lane on an install whose Anthropic key is
 * empty is served by KIE on the same registry model — the leg a refused
 * account gets — instead of throwing before any lane runs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { z } from "zod"

const cfg = vi.hoisted(() => ({ KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", NODE_ENV: "test" }))
vi.mock("../config.js", () => ({ config: cfg, hasCredits: () => true }))
const sdk = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }))
vi.mock("../anthropic.js", () => ({ getAnthropicClient: () => ({ messages: { create: sdk.create, stream: sdk.stream } }) }))

import { __resetKeylessPinWarning } from "../llm/router.js"

function sse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}
const kieText = (text: string) => sse([
  `data: {"type":"content_block_delta","delta":{"text":${JSON.stringify(text)}}}\n`,
  'data: {"type":"message_delta","usage":{"input_tokens":1,"output_tokens":1}}\n',
])
const pinned = () => ({
  modelId: "claude-sonnet-4.6",
  system: "s",
  messages: [{ role: "user" as const, content: "hi" }],
  requireLane: "direct" as const,
})

let fetchMock: ReturnType<typeof vi.fn>
let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  cfg.ANTHROPIC_API_KEY = ""
  cfg.KIE_API_KEY = "test-kie-key"
  sdk.create.mockReset()
  sdk.stream.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  __resetKeylessPinWarning()
})
afterEach(() => {
  vi.unstubAllGlobals()
  warnSpy.mockRestore()
})

describe("a direct Claude pin with no Anthropic key", () => {
  it("llmComplete is served by KIE and says so", async () => {
    fetchMock.mockResolvedValue(kieText("hello"))
    const { llmComplete } = await import("../llm-client.js")
    const res = await llmComplete(pinned())
    expect(res.lane).toBe("kie")
    expect(res.text).toBe("hello")
    expect(sdk.create).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("no Anthropic key is set — serving from KIE"))).toBe(true)
  })

  it("says so once per process, not once per call", async () => {
    fetchMock.mockImplementation(async () => kieText("hello"))
    const { llmComplete, llmStream } = await import("../llm-client.js")
    await llmComplete(pinned())
    await llmStream(pinned(), () => {})
    await llmComplete(pinned())
    const lines = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("no Anthropic key is set — serving from KIE"))
    expect(lines).toHaveLength(1)
  })

  it("a whitespace key reads as no key", async () => {
    cfg.ANTHROPIC_API_KEY = "   "
    fetchMock.mockResolvedValue(kieText("hello"))
    const { llmComplete } = await import("../llm-client.js")
    expect((await llmComplete(pinned())).lane).toBe("kie")
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it("llmStream is served by KIE", async () => {
    fetchMock.mockResolvedValue(kieText("streamed"))
    const { llmStream } = await import("../llm-client.js")
    const tokens: string[] = []
    const res = await llmStream(pinned(), (t) => tokens.push(t))
    expect(res.lane).toBe("kie")
    expect(tokens.join("")).toBe("streamed")
    expect(sdk.stream).not.toHaveBeenCalled()
  })

  it("a pinned structured call is served by KIE as prompt-JSON", async () => {
    fetchMock.mockResolvedValue(kieText('{"ok":true}'))
    const { llmCompleteStructured } = await import("../llm-client.js")
    const res = await llmCompleteStructured(pinned(), z.object({ ok: z.boolean() }), { schemaName: "probe", maxRetries: 0 })
    expect(res.output).toEqual({ ok: true })
    expect(sdk.create).not.toHaveBeenCalled()
  })

  it("with no KIE key either, the pin still fails naming the missing key", async () => {
    cfg.KIE_API_KEY = ""
    const { llmComplete, llmStream } = await import("../llm-client.js")
    await expect(llmComplete(pinned())).rejects.toThrow(/ANTHROPIC_API_KEY is not set/)
    await expect(llmStream(pinned(), () => {})).rejects.toThrow(/ANTHROPIC_API_KEY is not set/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("with the key set, the pin goes direct as before", async () => {
    cfg.ANTHROPIC_API_KEY = "sk-ant-test"
    sdk.create.mockResolvedValue({ content: [{ type: "text", text: "direct" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } })
    const { llmComplete } = await import("../llm-client.js")
    const res = await llmComplete(pinned())
    expect(sdk.create).toHaveBeenCalledTimes(1)
    expect(res.lane).toBe("direct-anthropic")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
