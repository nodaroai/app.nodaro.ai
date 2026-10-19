/**
 * The loop on KIE's Anthropic-compatible endpoint: the KIE client and model
 * id, no thinking, prior thinking stripped, KIE's own charge read off the
 * stream, the size estimate when it states none, KIE rates for the budget,
 * the K13 retry ladder — and how a direct refusal is typed and handed back.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import Anthropic from "@anthropic-ai/sdk"
import { getLlmModel } from "@nodaro/shared/llm-models"

const m = vi.hoisted(() => ({
  directStream: vi.fn(),
  kieStream: vi.fn(),
  dispatch: vi.fn(),
  estimate: vi.fn(),
}))
vi.mock("@/lib/anthropic.js", () => ({ getAnthropicClient: vi.fn(() => ({ messages: { stream: m.directStream } })) }))
vi.mock("../kie-client.js", () => ({ getCopilotKieClient: vi.fn(() => ({ messages: { stream: m.kieStream } })) }))
vi.mock("../tools/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tools/registry.js")>()
  return { ...actual, dispatchTool: m.dispatch }
})
vi.mock("../budget.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../budget.js")>()
  m.estimate.mockImplementation(actual.estimateNextCallUsd)
  return { ...actual, estimateNextCallUsd: m.estimate }
})

const { runAgentLoop } = await import("../agent-loop.js")
const { COPILOT_TIERS } = await import("../constants.js")
const { CopilotDirectRefusedError } = await import("../lane.js")
const { getAnthropicClient } = await import("@/lib/anthropic.js")
const { LlmPlatformExhaustedError } = await import("../../../lib/llm-errors.js")
const { __resetPlatformExhaustionAlerts, directLaneLatch } = await import("../../../lib/llm-platform-exhaustion.js")
const { kieCostUsd } = await import("../../../lib/llm/kie-cost.js")

type Handler = (...args: unknown[]) => void
function fakeStream(opts: { final?: Partial<Anthropic.Messages.Message>; text?: string; events?: unknown[]; error?: unknown } = {}) {
  const handlers: Record<string, Handler> = {}
  return {
    on: (event: string, handler: Handler) => {
      handlers[event] = handler
      return undefined
    },
    abort: vi.fn(),
    finalMessage: async () => {
      if (opts.text) handlers.text?.(opts.text)
      for (const event of opts.events ?? []) handlers.streamEvent?.(event, {})
      if (opts.error) throw opts.error
      return {
        id: "msg",
        type: "message",
        role: "assistant",
        model: "m",
        content: [{ type: "text", text: "done", citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 2, output_tokens: 50, cache_read_input_tokens: 4389, cache_creation_input_tokens: 411 },
        ...opts.final,
      } as Anthropic.Messages.Message
    },
  }
}
const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers())
const delta = (extra: Record<string, unknown> = {}) => ({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 50 }, ...extra })

const baseInput = () => ({
  tier: COPILOT_TIERS.standard,
  system: "system",
  tools: [],
  history: [] as Anthropic.Messages.MessageParam[],
  userContent: [{ type: "text" as const, text: "hi" }],
  budget: { limitUsd: 10, reservedCredits: 150 },
  signal: new AbortController().signal,
  deps: { ctx: {} as never, invoker: {} as never, addedNodeTypes: new Set<string>(), wiredAssets: [], created: { count: 0 } },
  events: { onToken: vi.fn(), onToolCall: vi.fn(), onIteration: vi.fn() },
  isCancelRequested: async () => false,
  kieRetryDelayMs: 0,
})

beforeEach(() => {
  m.directStream.mockReset()
  m.kieStream.mockReset()
  m.dispatch.mockReset()
  m.dispatch.mockResolvedValue({ text: "ok", isError: false })
  m.estimate.mockClear()
  vi.mocked(getAnthropicClient).mockClear()
  __resetPlatformExhaustionAlerts()
})

describe("a turn on KIE", () => {
  it("uses the KIE client and the registry's KIE model id, with no thinking or effort", async () => {
    m.kieStream.mockReturnValue(fakeStream({ events: [delta({ credits_consumed: 0.1 })] }))
    const result = await runAgentLoop({ ...baseInput(), tier: COPILOT_TIERS.premium, lane: "kie" })
    expect(result.stopReason).toBe("completed")
    expect(getAnthropicClient).not.toHaveBeenCalled()
    const params = m.kieStream.mock.calls[0]![0] as Record<string, unknown>
    expect(params.model).toBe(getLlmModel(COPILOT_TIERS.premium.registryId)!.kieSlugOrModel)
    expect(params.thinking).toBeUndefined()
    expect(params.output_config).toBeUndefined()
  })

  it("replays prior turns without their thinking blocks (the standard tier keeps them on direct)", async () => {
    const history: Anthropic.Messages.MessageParam[] = [
      { role: "user", content: [{ type: "text", text: "earlier" }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "sig" }, { type: "text", text: "ok" }] },
    ]
    m.kieStream.mockReturnValue(fakeStream())
    await runAgentLoop({ ...baseInput(), history, lane: "kie" })
    expect(JSON.stringify(m.kieStream.mock.calls[0]![0].messages)).not.toContain('"thinking"')

    m.directStream.mockReturnValue(fakeStream())
    await runAgentLoop({ ...baseInput(), history })
    expect(JSON.stringify(m.directStream.mock.calls[0]![0].messages)).toContain('"thinking"')
  })

  it("costs the call at KIE's own charge from message_delta, and records none of KIE's prefix as our cache", async () => {
    m.kieStream.mockReturnValue(fakeStream({ events: [{ type: "message_start" }, delta({ credits_consumed: 0.1 })] }))
    const result = await runAgentLoop({ ...baseInput(), lane: "kie" })
    expect(result.usage.costUsd).toBeCloseTo(0.0005, 12)
    expect(result.usage.cacheReadTokens).toBe(0)
    expect(result.usage.cacheWriteTokens).toBe(0)
    expect(result.usage.inputTokens).toBe(2)
    expect(result.usage.outputTokens).toBe(50)
  })

  it("estimates from the request and answer size at KIE rates when no charge is stated", async () => {
    m.kieStream.mockReturnValue(fakeStream())
    const input = baseInput()
    const result = await runAgentLoop({ ...input, lane: "kie" })
    const promptChars =
      input.system.length + JSON.stringify([{ role: "user", content: input.userContent }]).length + JSON.stringify([]).length
    const answerChars = JSON.stringify([{ type: "text", text: "done", citations: null }]).length
    expect(result.usage.costUsd).toBeCloseTo(kieCostUsd(COPILOT_TIERS.standard.registryId, { promptChars, answerChars }), 12)
    expect(result.usage.costUsd).toBeGreaterThan(0)
  })

  it("counts the spend carried in (priorCostUsd) in the turn's cost", async () => {
    m.kieStream.mockReturnValue(fakeStream({ events: [delta({ credits_consumed: 0.1 })] }))
    const result = await runAgentLoop({ ...baseInput(), lane: "kie", priorCostUsd: 0.01 })
    expect(result.usage.costUsd).toBeCloseTo(0.0105, 12)
  })

  it("runs on the turn's wall clock, not the loop's: a turn that started a wall clock ago is capped before any call", async () => {
    const tier = COPILOT_TIERS.standard
    const result = await runAgentLoop({ ...baseInput(), lane: "kie", startedAt: Date.now() - tier.caps.wallClockMs - 1 })
    expect(result.stopReason).toBe("capped")
    expect(m.kieStream).not.toHaveBeenCalled()
  })

  it("prices every next KIE call at KIE rates with no cache discount", async () => {
    m.kieStream
      .mockReturnValueOnce(fakeStream({ final: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "get_graph", input: {} }] } }))
      .mockReturnValueOnce(fakeStream())
    await runAgentLoop({ ...baseInput(), lane: "kie" })
    expect(m.estimate).toHaveBeenCalledTimes(2)
    expect(m.estimate.mock.calls[1]!.slice(2)).toEqual([false, "kie"])
  })
})

describe("K13 — a KIE failure that cost nothing", () => {
  it("is retried, and the turn completes", async () => {
    m.kieStream
      .mockReturnValueOnce(fakeStream({ error: apiError(429, "api_error", "Internal error") }))
      .mockReturnValueOnce(fakeStream({ error: apiError(400, "api_error", "Internal error") }))
      .mockReturnValueOnce(fakeStream({ events: [delta({ credits_consumed: 0.1 })] }))
    const result = await runAgentLoop({ ...baseInput(), lane: "kie" })
    expect(result.stopReason).toBe("completed")
    expect(m.kieStream).toHaveBeenCalledTimes(3)
    expect(result.usage.costUsd).toBeCloseTo(0.0005, 12)
  })

  it("is retried four times at most", async () => {
    m.kieStream.mockImplementation(() => fakeStream({ error: apiError(503, "api_error", "Service unavailable") }))
    await expect(runAgentLoop({ ...baseInput(), lane: "kie" })).rejects.toThrow()
    expect(m.kieStream).toHaveBeenCalledTimes(5)
  })

  it("a cancel during the pause ends the turn at once — no further attempt", async () => {
    const controller = new AbortController()
    m.kieStream.mockImplementation(() => {
      setTimeout(() => controller.abort(), 5)
      return fakeStream({ error: apiError(503, "api_error", "Service unavailable") })
    })
    const started = Date.now()
    const result = await runAgentLoop({ ...baseInput(), lane: "kie", signal: controller.signal, kieRetryDelayMs: 60_000 })
    expect(result.stopReason).toBe("cancelled")
    expect(m.kieStream).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it("no retry after a token — the turn ends as today", async () => {
    m.kieStream.mockImplementation(() => fakeStream({ text: "partial", error: apiError(500, "api_error", "boom") }))
    const input = baseInput()
    await expect(runAgentLoop({ ...input, lane: "kie" })).rejects.toThrow()
    expect(m.kieStream).toHaveBeenCalledTimes(1)
    expect(input.events.onToken).toHaveBeenCalledWith("partial")
  })

  it("no retry after message_delta — KIE already charged for it", async () => {
    m.kieStream.mockImplementation(() => fakeStream({ events: [delta()], error: apiError(500, "api_error", "boom") }))
    await expect(runAgentLoop({ ...baseInput(), lane: "kie" })).rejects.toThrow()
    expect(m.kieStream).toHaveBeenCalledTimes(1)
  })

  it("a KIE 401 is typed to KIE, not retried, and never arms the Anthropic latch", async () => {
    m.kieStream.mockImplementation(() => fakeStream({ error: apiError(401, "authentication_error", "bad key") }))
    const err = await runAgentLoop({ ...baseInput(), lane: "kie" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmPlatformExhaustedError)
    expect((err as InstanceType<typeof LlmPlatformExhaustedError>).provider).toBe("kie")
    expect((err as InstanceType<typeof LlmPlatformExhaustedError>).lane).toBe("kie")
    expect(m.kieStream).toHaveBeenCalledTimes(1)
    expect(directLaneLatch("anthropic")).toBeNull()
  })
})

describe("a direct refusal", () => {
  const drained = () => apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")

  it("on the first call, before any token, hands the turn back for KIE — typed, alerted and latched", async () => {
    m.directStream.mockReturnValue(fakeStream({ error: drained() }))
    const err = await runAgentLoop(baseInput()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CopilotDirectRefusedError)
    expect(directLaneLatch("anthropic")?.kind).toBe("billing")
  })

  it("a refused key latches too", async () => {
    m.directStream.mockReturnValue(fakeStream({ error: apiError(401, "authentication_error", "invalid x-api-key") }))
    const err = await runAgentLoop(baseInput()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CopilotDirectRefusedError)
    expect(directLaneLatch("anthropic")?.kind).toBe("auth")
  })

  it("after a token ends the turn instead", async () => {
    m.directStream.mockReturnValue(fakeStream({ text: "hel", error: drained() }))
    const err = await runAgentLoop(baseInput()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmPlatformExhaustedError)
    expect(err).not.toBeInstanceOf(CopilotDirectRefusedError)
  })
})
