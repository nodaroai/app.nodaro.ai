/**
 * callLLM on the KIE lane. An attempt runs on KIE as prompt-JSON — the stage's
 * schema in the system prompt, no tool — when the platform's Anthropic account
 * cannot serve it (no key; a refused balance or key, which also latches; the
 * latch already open) or when the direct API rejects the stage's tool schema.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

const mocks = vi.hoisted(() => {
  const messagesCreate = vi.fn()
  return {
    messagesCreate,
    getAnthropicClient: vi.fn(() => ({ messages: { create: messagesCreate } })),
    callKie: vi.fn(),
    prefetch: vi.fn(),
  }
})
vi.mock("../../../../lib/anthropic.js", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
  CLAUDE_MODEL: "claude-sonnet-4-5-20250929",
}))
vi.mock("../../../../lib/llm/kie-lane.js", () => ({ callKie: mocks.callKie }))
vi.mock("../../../../lib/anthropic-image.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/anthropic-image.js")>()),
  prefetchAsBase64: mocks.prefetch,
}))

import { config } from "../../../../lib/config.js"
import {
  buildStageRequest,
  callLLM,
  CallLLMRefusalError,
  PIPELINE_KIE_BURST,
  PIPELINE_KIE_BUSY_MESSAGE,
  PIPELINE_KIE_TIMEOUT_MS,
  type ProgressUpdate,
} from "../call-llm.js"
import { pipelineContext } from "../../pipeline-context.js"
import {
  LLM_CONTENT_REFUSAL_MESSAGE,
  LlmContentRefusalError,
  LlmLaneError,
  LlmOutputTruncatedError,
  LlmPlatformExhaustedError,
} from "../../../../lib/llm-errors.js"
import {
  PLATFORM_CAPACITY_MESSAGE,
  __resetPlatformExhaustionAlerts,
  directLaneLatch,
  latchDirectLaneExhausted,
} from "../../../../lib/llm-platform-exhaustion.js"
import { kieCostUsd, requestChars } from "../../../../lib/llm/kie-cost.js"
import type { LlmRequest, LlmResponse } from "../../../../lib/llm/types.js"

const schema = z.object({ greeting: z.string() })

function fakeSupabase(opts: { laneColumn?: boolean } = {}) {
  const inserts: Array<Record<string, unknown>> = []
  const missing = { code: "PGRST204", message: "Could not find the 'lane' column of 'llm_calls' in the schema cache" }
  const client = {
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row)
        const error = opts.laneColumn === false && "lane" in row ? missing : null
        return Object.assign(Promise.resolve({ error }), {
          select: () => ({ single: async () => ({ data: error ? null : { id: "llm-call-1" }, error }) }),
        })
      },
    }),
  }
  return { client: client as never, inserts }
}

const kieAnswer = (json: unknown, extra: Partial<LlmResponse> = {}): LlmResponse => ({
  text: JSON.stringify(json),
  usage: { inputTokens: 2, outputTokens: 40 },
  model: "claude-sonnet-5.5",
  providerCost: 0.0000123,
  lane: "kie",
  ...extra,
})
const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers())
const drained = () => apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API.")
const revoked = () => apiError(401, "authentication_error", "invalid x-api-key")
const schemaRejected = () =>
  apiError(400, "invalid_request_error", "tools.0.custom.input_schema: JSON schema is invalid. It must match JSON Schema draft 2020-12")
const directAnswer = (input: unknown) => ({
  content: [{ type: "tool_use", name: "emit", input }],
  stop_reason: "tool_use",
  usage: { input_tokens: 10, output_tokens: 5 },
})

const args = (client: never, over: Record<string, unknown> = {}) => ({
  supabase: client,
  pipelineId: "p1",
  stageId: "s1",
  userId: "u1",
  role: "critic" as const,
  task: "script_critic",
  modelId: "claude-sonnet-5-5",
  systemPrompt: "SYSTEM",
  userPrompt: "hi",
  schema,
  maxRetries: 1,
  ...over,
})
const kieCall = (n = 0) => mocks.callKie.mock.calls[n] as [{ id: string; displayName: string }, LlmRequest, AbortSignal]

const saved = { anthropic: config.ANTHROPIC_API_KEY, kie: config.KIE_API_KEY, burst: { ...PIPELINE_KIE_BURST } }
let errorSpy: MockInstance<typeof console.error>
let warnSpy: MockInstance<typeof console.warn>
beforeEach(() => {
  vi.clearAllMocks()
  __resetPlatformExhaustionAlerts()
  config.ANTHROPIC_API_KEY = "sk-ant-test"
  config.KIE_API_KEY = "kie-test"
  mocks.prefetch.mockImplementation(async (url: string) => ({ type: "image_base64", mediaType: "image/png", data: `b64:${url}` }))
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  // No burst ride-out unless a test opts in: a single KIE failure is final.
  Object.assign(PIPELINE_KIE_BURST, { pauseMs: 0, windowMs: 0 })
})
afterEach(() => {
  config.ANTHROPIC_API_KEY = saved.anthropic
  config.KIE_API_KEY = saved.kie
  Object.assign(PIPELINE_KIE_BURST, saved.burst)
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})

describe("choosing the lane", () => {
  it("an empty key sends the stage to KIE as prompt-JSON and never builds a direct client", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie.mockResolvedValueOnce(kieAnswer({ greeting: "hi" }))
    const { client, inserts } = fakeSupabase()
    const result = await callLLM(args(client))
    expect(result.output).toEqual({ greeting: "hi" })
    expect(mocks.getAnthropicClient).not.toHaveBeenCalled()
    const [model, req, signal] = kieCall()
    expect(model.id).toBe("claude-sonnet-5.5")
    // The stage's own prompt — not the direct lane's "Respond by calling the `emit` tool" line.
    expect(req.system).toBe("SYSTEM")
    expect(req.jsonSchema?.name).toBe("emit")
    // The draft-7 schema before the strict-tool rewrite the direct lane sends Sonnet 5.5.
    expect(req.jsonSchema?.schema).toEqual(
      buildStageRequest({ modelId: "claude-sonnet-5-5", task: "script_critic", systemPrompt: "SYSTEM", schema }).jsonSchema,
    )
    expect(req.failOnRefusal).toBe(true)
    expect(req.timeoutMs).toBe(PIPELINE_KIE_TIMEOUT_MS)
    expect(req.maxTokens).toBe(32768)
    expect(req.thinkingFlag).toBe(true)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ success: true, lane: "kie" })
    // No key is the K2 line's to say, once per process — not a line per attempt.
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("served from KIE"))).toBe(false)
  })

  it("a model that does not think by default is sent no thinkingFlag", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie.mockResolvedValueOnce(kieAnswer({ greeting: "hi" }))
    await callLLM(args(fakeSupabase().client, { modelId: "claude-sonnet-4-6" }))
    expect(kieCall()[1].thinkingFlag).toBeUndefined()
  })

  it("a refused balance is answered by KIE in the same attempt, alerts, latches, and the next call skips direct", async () => {
    mocks.messagesCreate.mockRejectedValueOnce(drained())
    mocks.callKie.mockResolvedValue(kieAnswer({ greeting: "hi" }))
    const { client } = fakeSupabase()
    await callLLM(args(client))
    expect(mocks.messagesCreate).toHaveBeenCalledTimes(1)
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(directLaneLatch("anthropic")?.kind).toBe("billing")
    const alerts = errorSpy.mock.calls.map((c) => String(c[0]))
    expect(alerts.some((l) => l.startsWith("[ALERT] LLM provider anthropic"))).toBe(true)
    // The billing 400 is the account, not the schema: no schema alert.
    expect(alerts.some((l) => l.includes("rejected the emit tool schema"))).toBe(false)

    await callLLM(args(client))
    expect(mocks.messagesCreate).toHaveBeenCalledTimes(1)
    expect(mocks.callKie).toHaveBeenCalledTimes(2)
  })

  it("a refused key latches too", async () => {
    mocks.messagesCreate.mockRejectedValueOnce(revoked())
    mocks.callKie.mockResolvedValue(kieAnswer({ greeting: "hi" }))
    await callLLM(args(fakeSupabase().client))
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(directLaneLatch("anthropic")?.kind).toBe("auth")
    expect(warnSpy.mock.calls.some((c) => /served from KIE — the Anthropic account refused/.test(String(c[0])))).toBe(true)
  })

  it("a direct 400 rejecting the tool schema re-runs that attempt on KIE with an [ALERT], and does not latch", async () => {
    mocks.messagesCreate.mockRejectedValueOnce(schemaRejected())
    mocks.callKie.mockResolvedValue(kieAnswer({ greeting: "hi" }))
    const result = await callLLM(args(fakeSupabase().client))
    expect(result.output.greeting).toBe("hi")
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls.some((c) => /^\[ALERT\] pipeline script_critic: direct claude-sonnet-5-5 rejected the emit tool schema/.test(String(c[0])))).toBe(true)
    expect(directLaneLatch("anthropic")).toBeNull()
  })

  it("an open latch goes to KIE without asking direct", async () => {
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "refused" })
    mocks.callKie.mockResolvedValue(kieAnswer({ greeting: "hi" }))
    await callLLM(args(fakeSupabase().client))
    expect(mocks.messagesCreate).not.toHaveBeenCalled()
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls.map((c) => String(c[0]))).toContain(
      "[callLLM] script_critic: claude-sonnet-5-5 served from KIE — the Anthropic direct lane is latched",
    )
  })

  it("with no KIE key, a refused balance fails with the capacity sentence as before", async () => {
    config.KIE_API_KEY = ""
    mocks.messagesCreate.mockRejectedValueOnce(drained())
    const err = await callLLM(args(fakeSupabase().client)).catch((e: unknown) => e)
    expect((err as Error).message).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect(mocks.callKie).not.toHaveBeenCalled()
  })

  it("a healthy direct call records lane direct", async () => {
    mocks.messagesCreate.mockResolvedValueOnce(directAnswer({ greeting: "hi" }))
    const { client, inserts } = fakeSupabase()
    await callLLM(args(client))
    expect(mocks.callKie).not.toHaveBeenCalled()
    expect(inserts[0]).toMatchObject({ success: true, lane: "direct" })
  })
})

describe("the KIE attempt", () => {
  const imagePrompt = [
    { type: "image" as const, source: { type: "url" as const, url: "https://r2.example/a.png" } },
    { type: "image" as const, source: { type: "url" as const, url: "https://r2.example/huge.png" } },
    { type: "text" as const, text: "judge" },
  ]

  it("inlines images once per call (re-used across retries), passing a URL through when no inline form fits", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.prefetch.mockImplementation(async (url: string) =>
      url.endsWith("huge.png") ? { type: "image", url } : { type: "image_base64", mediaType: "image/png", data: `b64:${url}` },
    )
    mocks.callKie.mockResolvedValueOnce(kieAnswer({ wrong: 1 })).mockResolvedValueOnce(kieAnswer({ greeting: "hi" }))
    await callLLM(args(fakeSupabase().client, { userPrompt: imagePrompt }))
    expect(mocks.prefetch).toHaveBeenCalledTimes(2)
    expect(kieCall(0)[1].messages[0]!.content).toEqual([
      { type: "image_base64", mediaType: "image/png", data: "b64:https://r2.example/a.png" },
      { type: "image", url: "https://r2.example/huge.png" },
      { type: "text", text: "judge" },
    ])
    // S12: the block prompt's retry carries the validation feedback as a final text block.
    const retry = kieCall(1)[1].messages[0]!.content as Array<{ type: string; text?: string }>
    expect(retry).toHaveLength(4)
    expect(retry[3]!.text).toMatch(/^YOUR PREVIOUS ATTEMPT FAILED VALIDATION:\ngreeting: /)
  })

  it("a block prompt's retry carries the feedback on the direct lane too", async () => {
    mocks.messagesCreate
      .mockResolvedValueOnce(directAnswer({ wrong: 1 }))
      .mockResolvedValueOnce(directAnswer({ greeting: "hi" }))
    await callLLM(args(fakeSupabase().client, { userPrompt: [{ type: "text", text: "look" }], modelId: "claude-sonnet-4-6" }))
    expect(mocks.messagesCreate.mock.calls[0]![0].messages[0].content).toHaveLength(1)
    const retry = mocks.messagesCreate.mock.calls[1]![0].messages[0].content as Array<{ text: string }>
    expect(retry).toHaveLength(2)
    expect(retry[1]!.text).toMatch(/^YOUR PREVIOUS ATTEMPT FAILED VALIDATION:/)
  })

  it("the pipeline's cancel reaches the KIE call (combined with the 600 s deadline)", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie.mockResolvedValueOnce(kieAnswer({ greeting: "hi" }))
    const ctrl = new AbortController()
    await pipelineContext.run({ signal: ctrl.signal, pipelineId: "p1" }, () => callLLM(args(fakeSupabase().client)))
    const signal = kieCall()[2]
    expect(signal.aborted).toBe(false)
    ctrl.abort()
    expect(signal.aborted).toBe(true)
  })

  it("a pipeline cancel during a KIE attempt is rethrown as itself", async () => {
    config.ANTHROPIC_API_KEY = ""
    const ctrl = new AbortController()
    mocks.callKie.mockImplementationOnce(async () => {
      ctrl.abort()
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" })
    })
    const err = await pipelineContext
      .run({ signal: ctrl.signal, pipelineId: "p1" }, () => callLLM(args(fakeSupabase().client)))
      .catch((e: unknown) => e)
    expect((err as Error).name).toBe("AbortError")
    expect((err as Error).message).not.toBe(PIPELINE_KIE_BUSY_MESSAGE)
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
  })

  it("a pipeline cancel is read from the pipeline's signal, not the error — a transport error thrown after it is rethrown unchanged", async () => {
    config.ANTHROPIC_API_KEY = ""
    const ctrl = new AbortController()
    const transport = new LlmLaneError("KIE.ai messages claude-sonnet-5.5 failed (503)", { lane: "kie", httpStatus: 503 })
    mocks.callKie.mockImplementationOnce(async () => {
      ctrl.abort()
      throw transport
    })
    const { client, inserts } = fakeSupabase()
    const err = await pipelineContext
      .run({ signal: ctrl.signal, pipelineId: "p1" }, () => callLLM(args(client)))
      .catch((e: unknown) => e)
    expect(err).toBe(transport)
    expect((err as Error).message).not.toBe(PIPELINE_KIE_BUSY_MESSAGE)
    expect(inserts).toHaveLength(0)
  })

  it("the 600 s deadline firing on its own is a KIE failure (busy sentence), not a pipeline cancel — and not ridden out", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    const ctrl = new AbortController()
    mocks.callKie.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    const { client, inserts } = fakeSupabase()
    const err = await pipelineContext
      .run({ signal: ctrl.signal, pipelineId: "p1" }, () => callLLM(args(client)))
      .catch((e: unknown) => e)
    expect((err as Error).message).toBe(PIPELINE_KIE_BUSY_MESSAGE)
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ success: false, lane: "kie" })
  })

  it("an onProgress caller gets starting before and finalizing after", async () => {
    config.ANTHROPIC_API_KEY = ""
    const answer = kieAnswer({ greeting: "hi" })
    mocks.callKie.mockResolvedValueOnce(answer)
    const events: ProgressUpdate[] = []
    await callLLM(args(fakeSupabase().client, { onProgress: (u: ProgressUpdate) => events.push(u) }))
    expect(events).toEqual([{ phase: "starting" }, { phase: "finalizing", bytesSoFar: answer.text.length }])
  })

  it("a content refusal on KIE fails at once, with its row on lane kie", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie.mockRejectedValueOnce(
      new LlmContentRefusalError(`${LLM_CONTENT_REFUSAL_MESSAGE} (kie)`, { inputTokens: 2, outputTokens: 12, providerCost: 0.0004, complete: true }),
    )
    const { client, inserts } = fakeSupabase()
    const err = await callLLM(args(client)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(CallLLMRefusalError)
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(inserts[0]).toMatchObject({ success: false, lane: "kie", cost_usd: 0.0004 })
    expect(String(inserts[0]!.error)).toMatch(/^refusal: kie claude-sonnet-5-5/)
  })

  it("a cut-off answer on KIE gets the one concise retry", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie
      .mockRejectedValueOnce(new LlmOutputTruncatedError("cut", { inputTokens: 2, outputTokens: 32768, providerCost: 0.13, complete: true }))
      .mockResolvedValueOnce(kieAnswer({ greeting: "hi" }, { creditsUsd: 0.001 }))
    const result = await callLLM(args(fakeSupabase().client))
    expect(result.output.greeting).toBe("hi")
    const retryText = (kieCall(1)[1].messages[0]!.content as Array<{ text: string }>)[0]!.text
    expect(retryText).toMatch(/cut off at the output token cap/)
    expect(result.costUsd).toBeCloseTo(0.131, 10)
  })

  it("a KIE failure reads as the busy sentence, the raw reply kept for the operator", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie.mockRejectedValueOnce(
      new LlmLaneError('KIE.ai messages claude-sonnet-5.5 failed (429): {"type":"error","error":{"type":"api_error"}}', { lane: "kie", httpStatus: 429 }),
    )
    const { client, inserts } = fakeSupabase()
    const err = (await callLLM(args(client)).catch((e: unknown) => e)) as Error & { internalDetails?: string }
    expect(err.message).toBe(PIPELINE_KIE_BUSY_MESSAGE)
    expect(err.internalDetails).toMatch(/failed \(429\)/)
    expect(inserts[0]).toMatchObject({ success: false, lane: "kie" })
  })

  it("a pinned model KIE cannot serve fails naming it (K14), no substitution", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie.mockRejectedValueOnce(new LlmLaneError("KIE.ai messages claude-opus-5: no_available_account", { lane: "kie" }))
    const err = await callLLM(args(fakeSupabase().client, { modelId: "claude-opus-5" })).catch((e: unknown) => e)
    expect((err as Error).message).toBe(
      "Claude Opus 5 isn't available right now — switch the script model to Claude Sonnet 5.5 or try again later",
    )
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(kieCall()[0].id).toBe("claude-opus-5")
  })
})

describe("cost and the llm_calls row", () => {
  it("is KIE's own charge when the reply carried it", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie.mockResolvedValueOnce(kieAnswer({ greeting: "hi" }, { creditsUsd: 0.0007 }))
    const { client, inserts } = fakeSupabase()
    const result = await callLLM(args(client))
    expect(result.costUsd).toBe(0.0007)
    expect(inserts[0]).toMatchObject({ cost_usd: 0.0007, input_tokens: 2, output_tokens: 40, lane: "kie" })
  })

  it("is the size estimate at KIE rates when it carried none — never the 2 reported input tokens", async () => {
    config.ANTHROPIC_API_KEY = ""
    const answer = kieAnswer({ greeting: "hi" })
    mocks.callKie.mockResolvedValueOnce(answer)
    const result = await callLLM(args(fakeSupabase().client))
    const expected = kieCostUsd("claude-sonnet-5.5", { promptChars: requestChars(kieCall()[1]), answerChars: answer.text.length })
    expect(result.costUsd).toBeCloseTo(expected, 12)
    expect(result.costUsd).not.toBeCloseTo(answer.providerCost!, 12)
  })

  it("tolerant insert — success and failure rows are written again without lane when the column is missing", async () => {
    config.ANTHROPIC_API_KEY = ""
    mocks.callKie.mockResolvedValueOnce(kieAnswer({ greeting: "hi" }))
    const ok = fakeSupabase({ laneColumn: false })
    const result = await callLLM(args(ok.client))
    expect(result.llmCallId).toBe("llm-call-1")
    expect(ok.inserts).toHaveLength(2)
    expect(ok.inserts[1]).not.toHaveProperty("lane")

    mocks.callKie.mockRejectedValueOnce(new LlmLaneError("KIE.ai messages failed (503)", { lane: "kie", httpStatus: 503 }))
    const failed = fakeSupabase({ laneColumn: false })
    await callLLM(args(failed.client)).catch(() => undefined)
    expect(failed.inserts).toHaveLength(2)
    expect(failed.inserts[1]).toMatchObject({ success: false })
    expect(failed.inserts[1]).not.toHaveProperty("lane")
  })
})

describe("riding out a KIE failure burst", () => {
  // Two tests below give callKie a lasting implementation; it must not outlive them.
  afterEach(() => {
    mocks.callKie.mockReset()
  })
  const transport = () => new LlmLaneError("KIE.ai messages claude-sonnet-5.5 failed (429)", { lane: "kie", httpStatus: 429 })
  /** A clock each KIE try moves forward by `stepMs` — the time one failed try plus its pause takes. */
  const fakeClock = (stepMs: number) => {
    let now = 1_000_000
    PIPELINE_KIE_BURST.now = () => now
    return () => {
      now += stepMs
    }
  }

  it("a burst of failures that cost nothing, then an answer: the stage succeeds with one row, its validation retries untouched", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    mocks.callKie
      .mockRejectedValueOnce(transport())
      .mockRejectedValueOnce(
        new LlmLaneError('KIE.ai messages claude-sonnet-5.5 failed (400): {"type":"error","error":{"type":"api_error","message":"Internal error"}}', {
          lane: "kie",
          httpStatus: 400,
        }),
      )
      .mockRejectedValueOnce(transport())
      .mockResolvedValueOnce(kieAnswer({ greeting: "hi" }))
    const { client, inserts } = fakeSupabase()
    const result = await callLLM(args(client, { maxRetries: 0 }))
    expect(result.output.greeting).toBe("hi")
    expect(mocks.callKie).toHaveBeenCalledTimes(4)
    // The same request every time: no validation feedback, no re-inlining.
    expect(kieCall(3)[1].messages).toEqual(kieCall(0)[1].messages)
    // The first try keeps callKie's own transport ladder; a burst try is one shot — the burst's pauses are its ladder.
    expect(kieCall(0)[1].retryStreamOnError).toBeUndefined()
    expect(kieCall(1)[1].retryStreamOnError).toBe(false)
    expect(kieCall(3)[1].retryStreamOnError).toBe(false)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ success: true, lane: "kie" })
  })

  it("failures that outlast the window end in the busy sentence, with one row", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    const tick = fakeClock(50_000)
    mocks.callKie.mockImplementation(async () => {
      tick()
      throw transport()
    })
    const { client, inserts } = fakeSupabase()
    const err = await callLLM(args(client)).catch((e: unknown) => e)
    expect((err as Error).message).toBe(PIPELINE_KIE_BUSY_MESSAGE)
    // The window runs from the first KIE call (to +180 s): failures at +50, +100, +150 s are tried again; the one at +200 s is final.
    expect(mocks.callKie).toHaveBeenCalledTimes(4)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ success: false, lane: "kie" })
  })

  it("the window counts from the first KIE call, so a slow first failure leaves little of it", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    let now = 1_000_000
    PIPELINE_KIE_BURST.now = () => now
    mocks.callKie
      .mockImplementationOnce(async () => {
        now += 170_000 // the first try (its own transport ladder included) fails at +170 s
        throw transport()
      })
      .mockImplementation(async () => {
        now += 20_000
        throw transport()
      })
    const err = await callLLM(args(fakeSupabase().client)).catch((e: unknown) => e)
    expect((err as Error).message).toBe(PIPELINE_KIE_BUSY_MESSAGE)
    // +170 s < +180 s: one more try, failing at +190 s — past the window, so final.
    expect(mocks.callKie).toHaveBeenCalledTimes(2)
  })

  it("never tries past the stage's 600 s KIE deadline, whatever the window", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 10 * PIPELINE_KIE_TIMEOUT_MS
    const tick = fakeClock(200_000)
    mocks.callKie.mockImplementation(async () => {
      tick()
      throw transport()
    })
    const err = await callLLM(args(fakeSupabase().client)).catch((e: unknown) => e)
    expect((err as Error).message).toBe(PIPELINE_KIE_BUSY_MESSAGE)
    // Failing at +200 s and +400 s leaves time for another try; failing at +600 s does not.
    expect(mocks.callKie).toHaveBeenCalledTimes(3)
    // One deadline for the whole burst, not a fresh 600 s per try.
    expect(kieCall(2)[2]).toBe(kieCall(0)[2])
  })

  it("a pipeline cancel during the pause ends the call at once as a cancel — no busy sentence, no further try, no row", async () => {
    config.ANTHROPIC_API_KEY = ""
    Object.assign(PIPELINE_KIE_BURST, { pauseMs: 60_000, windowMs: 180_000 })
    const ctrl = new AbortController()
    mocks.callKie.mockImplementationOnce(async () => {
      setTimeout(() => ctrl.abort(), 5)
      throw transport()
    })
    const { client, inserts } = fakeSupabase()
    const started = Date.now()
    const err = await pipelineContext
      .run({ signal: ctrl.signal, pipelineId: "p1" }, () => callLLM(args(client)))
      .catch((e: unknown) => e)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect((err as Error).name).toBe("AbortError")
    expect((err as Error).message).not.toBe(PIPELINE_KIE_BUSY_MESSAGE)
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(0)
  })

  it("KIE's own account refusing is not ridden out", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    const refused = new LlmPlatformExhaustedError("kie credits insufficient", { lane: "kie", provider: "kie", exhaustion: "billing", httpStatus: 402 })
    mocks.callKie.mockRejectedValueOnce(refused)
    const err = await callLLM(args(fakeSupabase().client)).catch((e: unknown) => e)
    expect((err as Error).message).toBe(refused.userMessage)
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
  })

  it("KIE having no account for the model (K14) fails at once with the pinned-model sentence", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    mocks.callKie.mockRejectedValueOnce(new LlmLaneError("KIE.ai messages claude-opus-5: no_available_account", { lane: "kie" }))
    const err = await callLLM(args(fakeSupabase().client, { modelId: "claude-opus-5" })).catch((e: unknown) => e)
    expect((err as Error).message).toBe(
      "Claude Opus 5 isn't available right now — switch the script model to Claude Sonnet 5.5 or try again later",
    )
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
  })

  it("a pinned model's transient failure is ridden out like any other, and ends in the pinned-model sentence", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    const tick = fakeClock(100_000)
    mocks.callKie.mockImplementation(async () => {
      tick()
      throw transport()
    })
    const err = await callLLM(args(fakeSupabase().client, { modelId: "claude-opus-5" })).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/^Claude Opus 5 isn't available right now/)
    expect(mocks.callKie).toHaveBeenCalledTimes(2)
  })

  it("a 4xx that will not clear fails at once with the busy sentence", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    mocks.callKie.mockRejectedValueOnce(
      new LlmLaneError('KIE.ai messages claude-sonnet-5.5 failed (400): {"type":"error","error":{"type":"invalid_request_error","message":"bad"}}', {
        lane: "kie",
        httpStatus: 400,
      }),
    )
    const { client, inserts } = fakeSupabase()
    const err = await callLLM(args(client)).catch((e: unknown) => e)
    expect((err as Error).message).toBe(PIPELINE_KIE_BUSY_MESSAGE)
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(1)
  })

  it("a failure KIE charged for is not ridden out", async () => {
    config.ANTHROPIC_API_KEY = ""
    PIPELINE_KIE_BURST.windowMs = 180_000
    const charged = Object.assign(transport(), { usage: { inputTokens: 10, outputTokens: 3, providerCost: 0.001, complete: false } })
    mocks.callKie.mockRejectedValueOnce(charged)
    const err = await callLLM(args(fakeSupabase().client)).catch((e: unknown) => e)
    expect((err as Error).message).toBe(PIPELINE_KIE_BUSY_MESSAGE)
    expect(mocks.callKie).toHaveBeenCalledTimes(1)
  })
})
