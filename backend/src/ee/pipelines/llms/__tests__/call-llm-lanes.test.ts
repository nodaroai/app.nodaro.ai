// callLLM — the film pipeline's own LLM caller — takes one llm slot per
// attempt (lib/concurrency-lanes/slot.ts): under the pipeline's run hold at
// the front of the user's line, the direct try and a KIE fallback in the SAME
// slot, and with the lanes off it changes nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// These tests wait for slots, so they run on the path where limits can be
// turned on (test-only: this release locks them, and a locked take never waits).
vi.mock("../../../../lib/concurrency-lanes/enforcement-available.js", () => ({ LANES_ENFORCEMENT_AVAILABLE: true }))
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { ConcurrencyGate, type WakeTarget } from "../../../../lib/concurrency-lanes/gate.js"
import type { LaneSizes } from "../../../../lib/concurrency-lanes/types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 1, local: 1, run: 1 } as LaneSizes,
  settings: { queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 },
  subscribed: [] as string[][],
  running: [] as number[],
}))
const mocks = vi.hoisted(() => ({ messagesCreate: vi.fn(), callKie: vi.fn() }))
vi.mock("../../../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../../../../lib/concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => refs.sizes,
  laneSettings: async () => refs.settings,
}))
vi.mock("../../../../lib/concurrency-lanes/wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (queues: string[], _onWake: (t: WakeTarget[]) => Promise<void>) => {
    refs.subscribed.push(queues)
    return () => {}
  },
}))
vi.mock("../../../../lib/anthropic.js", () => ({
  getAnthropicClient: () => ({ messages: { create: mocks.messagesCreate } }),
  CLAUDE_MODEL: "claude-sonnet-4-5-20250929",
}))
vi.mock("../../../../lib/llm/kie-lane.js", () => ({ callKie: mocks.callKie }))

const { runHolding, laneCounters, resetLaneCountersForTests } = await import("../../../../lib/concurrency-lanes/hold.js")
const { resetConcurrencySlotsForTests } = await import("../../../../lib/concurrency-lanes/slot.js")
const { callLLM } = await import("../call-llm.js")
const { pipelineContext } = await import("../../pipeline-context.js")
const { config } = await import("../../../../lib/config.js")
const { __resetPlatformExhaustionAlerts } = await import("../../../../lib/llm-platform-exhaustion.js")
type ConcurrencyHold = import("../../../../lib/concurrency-lanes/hold.js").ConcurrencyHold

const run: ConcurrencyHold = { role: "run", lane: "run", userId: "U", payer: "user:U", tier: "pro", jobId: "pipe-1", leaseId: "run-lease", waitTable: "pipelines" }
const schema = z.object({ greeting: z.string() })

let gate: ConcurrencyGate

const llmRunning = async () => (await gate.snapshot()).lines.find((l) => l.userId === "U")?.lanes.llm.running ?? 0
const answer = (input: unknown) => async () => {
  refs.running.push(await llmRunning())
  return { content: [{ type: "tool_use", name: "emit", input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } }
}

function fakeSupabase() {
  return {
    from: () => ({
      insert: () => Object.assign(Promise.resolve({ error: null }), {
        select: () => ({ single: async () => ({ data: { id: "llm-call-1" }, error: null }) }),
      }),
    }),
  } as never
}

const args = (over: Record<string, unknown> = {}) => ({
  supabase: fakeSupabase(),
  pipelineId: "pipe-1",
  stageId: "s1",
  userId: "U",
  role: "detection" as const,
  task: "detection",
  modelId: "claude-sonnet-4-6",
  systemPrompt: "SYSTEM",
  userPrompt: "hi",
  schema,
  ...over,
})

const saved = { anthropic: config.ANTHROPIC_API_KEY, kie: config.KIE_API_KEY }
beforeEach(async () => {
  vi.clearAllMocks()
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.sizes = { provider: 1, llm: 1, local: 1, run: 1 }
  refs.subscribed = []
  refs.running = []
  resetLaneCountersForTests()
  resetConcurrencySlotsForTests()
  __resetPlatformExhaustionAlerts()
  config.ANTHROPIC_API_KEY = "sk-ant-test"
  config.KIE_API_KEY = "kie-test"
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  await gate.setEnforced(true)
})
afterEach(() => {
  config.ANTHROPIC_API_KEY = saved.anthropic
  config.KIE_API_KEY = saved.kie
  vi.restoreAllMocks()
})

describe("callLLM and the llm lane", () => {
  it("a pipeline stage LLM call takes a front llm slot", async () => {
    mocks.messagesCreate.mockImplementationOnce(answer({ greeting: "hello" }))
    const acquire = vi.spyOn(gate, "acquire")
    const r = await runHolding(run, () => callLLM(args()))
    expect(r.output).toEqual({ greeting: "hello" })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0]).toMatchObject({
      mode: "front",
      meta: { lane: "llm", provider: "anthropic", model: "claude-sonnet-4-6", jobType: "pipeline-llm:detection", queue: "inline", userId: "U" },
    })
    expect(refs.running).toEqual([1])
    expect(await llmRunning()).toBe(0)
  })

  it("each attempt takes its own slot; a retry after an invalid answer takes a second", async () => {
    mocks.messagesCreate.mockImplementationOnce(answer({ wrong: 1 })).mockImplementationOnce(answer({ greeting: "fixed" }))
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    const r = await runHolding(run, () => callLLM(args()))
    expect(r.output).toEqual({ greeting: "fixed" })
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenCalledTimes(2)
    expect(refs.running).toEqual([1, 1])
  })

  it("a direct refusal and its KIE fallback run in one slot", async () => {
    mocks.messagesCreate.mockRejectedValueOnce(
      Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, undefined, new Headers()),
    )
    mocks.callKie.mockImplementationOnce(async () => {
      refs.running.push(await llmRunning())
      return { text: JSON.stringify({ greeting: "kie" }), usage: { inputTokens: 2, outputTokens: 4 }, model: "claude-sonnet-4.6", providerCost: 0.001, lane: "kie" }
    })
    const acquire = vi.spyOn(gate, "acquire")
    const r = await runHolding(run, () => callLLM(args()))
    expect(r.output).toEqual({ greeting: "kie" })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(refs.running).toEqual([1])
    expect(await llmRunning()).toBe(0)
  })

  it("outside any hold an attempt is counted once as ungated", async () => {
    mocks.messagesCreate.mockImplementationOnce(answer({ greeting: "hello" }))
    const acquire = vi.spyOn(gate, "acquire")
    await callLLM(args())
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({ "pipeline-llm:detection": 1 })
  })

  // A full lane and an already-cancelled pipeline: the call runs as before.
  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    await gate.acquire({
      meta: { jobId: "other", userId: "U", payer: "user:U", lane: "llm", provider: null, source: null, sourceDetail: null, jobType: "x", model: null, queue: "video-generation", bullJobId: null },
      size: 1, mode: "fresh", leaseTtlMs: 3_600_000,
    })
    const ctrl = new AbortController()
    ctrl.abort()
    mocks.messagesCreate.mockImplementation(answer({ greeting: "hello" }))
    const bare = await pipelineContext.run({ signal: ctrl.signal, pipelineId: "pipe-1" }, () => callLLM(args()))
    const held = await runHolding(run, () => pipelineContext.run({ signal: ctrl.signal, pipelineId: "pipe-1" }, () => callLLM(args())))
    expect(held.output).toEqual(bare.output)
    // The cancel ends only a wait, and nothing waited: the provider was asked both times.
    expect(mocks.messagesCreate).toHaveBeenCalledTimes(2)
    expect(refs.subscribed).toEqual([])
    expect(await llmRunning()).toBe(1)
  })
})
