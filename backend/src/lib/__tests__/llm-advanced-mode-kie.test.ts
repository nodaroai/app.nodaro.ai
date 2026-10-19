/**
 * Advanced mode IS the vendor's own API: KIE ignores what it unlocks. So an
 * Advanced-mode Claude call is refused up front while Claude would run on KIE
 * (no key, or the account latched out), and a refusal met mid-call fails as
 * `advanced_mode_unavailable` — never served from KIE by the exhaustion
 * fallback, its latched skip, or a stream twin. A plain direct pin keeps the
 * fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

const cfg = vi.hoisted(() => ({ KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: "sk-ant-test", GEMINI_API_KEY: "", NODE_ENV: "test" }))
vi.mock("../config.js", () => ({ config: cfg, hasCredits: () => true }))
const sdk = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }))
vi.mock("../anthropic.js", () => ({ getAnthropicClient: () => ({ messages: { create: sdk.create, stream: sdk.stream } }) }))

import { ADVANCED_MODE_UNAVAILABLE_MESSAGE, LlmAdvancedModeUnavailableError } from "../llm-errors.js"
import { __resetPlatformExhaustionAlerts, latchDirectLaneExhausted } from "../llm-platform-exhaustion.js"
import { advancedModeError, resolveLlmParams } from "../llm-advanced-mode.js"
import { llmErrorCode, userFacingMessage } from "../user-facing-error.js"

const drained = () =>
  Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, undefined, new Headers())
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
const advanced = () => ({
  modelId: "claude-sonnet-4.6",
  system: "s",
  messages: [{ role: "user" as const, content: "hi" }],
  ...resolveLlmParams({ advancedMode: true }, { temperature: 0.3 }),
})

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  cfg.ANTHROPIC_API_KEY = "sk-ant-test"
  cfg.KIE_API_KEY = "test-kie-key"
  sdk.create.mockReset()
  sdk.stream.mockReset()
  __resetPlatformExhaustionAlerts()
  fetchMock = vi.fn().mockResolvedValue(kieText("from kie"))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("admission", () => {
  it("resolveLlmParams marks the request as Advanced", () => {
    expect(resolveLlmParams({ advancedMode: true })).toMatchObject({ requireLane: "direct", advancedMode: true })
    expect(resolveLlmParams({})).not.toHaveProperty("advancedMode")
  })

  it("refuses a Claude Advanced call while the Anthropic account is latched out", () => {
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "refused" })
    expect(advancedModeError({ advancedMode: true }, "claude-opus-5.5")).toEqual({
      code: "advanced_mode_unavailable",
      message: ADVANCED_MODE_UNAVAILABLE_MESSAGE,
    })
  })

  it("refuses with no key, and accepts a usable account", () => {
    expect(advancedModeError({ advancedMode: true }, "claude-opus-5.5")).toBeNull()
    cfg.ANTHROPIC_API_KEY = "  "
    expect(advancedModeError({ advancedMode: true }, "claude-opus-5.5")?.code).toBe("advanced_mode_unavailable")
  })

  it("ignoreLatch (describe-to-picker's admission) lets a latched account through, but never a missing key", () => {
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "refused" })
    expect(advancedModeError({ advancedMode: true }, "claude-opus-5.5", { ignoreLatch: true })).toBeNull()
    cfg.ANTHROPIC_API_KEY = ""
    expect(advancedModeError({ advancedMode: true }, "claude-opus-5.5", { ignoreLatch: true })?.code).toBe("advanced_mode_unavailable")
  })
})

describe("never served from KIE", () => {
  it("a refusal met mid-call fails as advanced_mode_unavailable — KIE is not asked", async () => {
    sdk.create.mockRejectedValue(drained())
    const { llmComplete } = await import("../llm-client.js")
    const err = await llmComplete(advanced()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmAdvancedModeUnavailableError)
    expect(llmErrorCode(err)).toBe("advanced_mode_unavailable")
    expect(userFacingMessage(err, "x")).toBe(ADVANCED_MODE_UNAVAILABLE_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("an open latch refuses before any request (no latched skip to KIE)", async () => {
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "refused" })
    const { llmComplete } = await import("../llm-client.js")
    await expect(llmComplete(advanced())).rejects.toBeInstanceOf(LlmAdvancedModeUnavailableError)
    expect(sdk.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("an empty key refuses (no keyless KIE pin)", async () => {
    cfg.ANTHROPIC_API_KEY = ""
    const { llmComplete } = await import("../llm-client.js")
    await expect(llmComplete(advanced())).rejects.toBeInstanceOf(LlmAdvancedModeUnavailableError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("the stream twin refuses too", async () => {
    sdk.stream.mockImplementation(() => {
      throw drained()
    })
    const { llmStream } = await import("../llm-client.js")
    await expect(llmStream(advanced(), () => {})).rejects.toBeInstanceOf(LlmAdvancedModeUnavailableError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("the stream twin refuses up front too: an open latch or an empty key — no SDK stream, no KIE request", async () => {
    const { llmStream } = await import("../llm-client.js")
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "refused" })
    const onToken = vi.fn()
    const err = await llmStream(advanced(), onToken).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmAdvancedModeUnavailableError)
    expect(llmErrorCode(err)).toBe("advanced_mode_unavailable")
    __resetPlatformExhaustionAlerts()
    cfg.ANTHROPIC_API_KEY = "  "
    await expect(llmStream(advanced(), onToken)).rejects.toBeInstanceOf(LlmAdvancedModeUnavailableError)
    expect(sdk.stream).not.toHaveBeenCalled()
    expect(sdk.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onToken).not.toHaveBeenCalled()
  })

  it("the streamed structured attempt refuses too", async () => {
    sdk.stream.mockImplementation(() => {
      throw drained()
    })
    const { llmStreamStructured } = await import("../llm-client.js")
    const err = await llmStreamStructured(advanced(), z.object({ ok: z.boolean() }), {
      schemaName: "probe",
      maxRetries: 0,
      onToolJson: () => {},
    }).catch((e: unknown) => e)
    expect(llmErrorCode(err)).toBe("advanced_mode_unavailable")
    // It went through the streamed attempt (the SDK stream), not a one-shot call.
    expect(sdk.stream).toHaveBeenCalled()
    expect(sdk.create).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a plain direct pin (not Advanced) keeps the exhaustion fallback", async () => {
    sdk.create.mockRejectedValue(drained())
    const { llmComplete } = await import("../llm-client.js")
    const res = await llmComplete({ modelId: "claude-sonnet-4.6", system: "s", messages: [{ role: "user", content: "hi" }], requireLane: "direct" })
    expect(res.lane).toBe("kie")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
