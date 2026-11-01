// Director authoring takes one llm slot per authoring call (author.ts): under
// the director's run hold at the front of the user's line, whatever llmFn is;
// the router's own slot (the default llmComplete) runs inside it, never a
// second; with the lanes off it changes nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// These tests wait for slots, so they run on the path where limits can be
// turned on (test-only: this release locks them, and a locked take never waits).
vi.mock("../../../lib/concurrency-lanes/enforcement-available.js", () => ({ LANES_ENFORCEMENT_AVAILABLE: true }))
import { ConcurrencyGate, type WakeTarget } from "../../../lib/concurrency-lanes/gate.js"
import type { LaneSizes } from "../../../lib/concurrency-lanes/types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 1, local: 1, run: 1 } as LaneSizes,
  settings: { queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 },
  subscribed: [] as string[][],
}))
vi.mock("../../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../../../lib/concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => refs.sizes,
  laneSettings: async () => refs.settings,
}))
vi.mock("../../../lib/concurrency-lanes/wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (queues: string[], _onWake: (t: WakeTarget[]) => Promise<void>) => {
    refs.subscribed.push(queues)
    return () => {}
  },
}))

const { runHolding, resetLaneCountersForTests } = await import("../../../lib/concurrency-lanes/hold.js")
const { resetConcurrencySlotsForTests, withConcurrencySlot } = await import("../../../lib/concurrency-lanes/slot.js")
const { llmSlot } = await import("../../../lib/llm/router.js")
const { resolveModel } = await import("../../../lib/llm/params.js")
const { authorShotSequence } = await import("../author.js")
type ConcurrencyHold = import("../../../lib/concurrency-lanes/hold.js").ConcurrencyHold
type LlmRequest = import("../../../lib/llm/types.js").LlmRequest

const GOOD = {
  voScript: "Ship faster. Watch it appear.",
  cues: [
    { id: "c1", text: "Ship faster" },
    { id: "c2", text: "Watch it appear" },
  ],
  shotSequenceBrief: {
    fps: 30,
    width: 1920,
    height: 1080,
    backgroundColor: "#000",
    narration: {
      script: "Ship faster. Watch it appear.",
      cues: [
        { id: "c1", text: "Ship faster" },
        { id: "c2", text: "Watch it appear" },
      ],
    },
    scenes: [
      {
        id: "s1",
        shots: [
          {
            id: "sh1",
            reveals: [
              {
                id: "r1",
                element: {
                  id: "e1",
                  type: "text",
                  text: "SHIP FASTER",
                  fontFamily: "Anton",
                  fontSize: 120,
                  color: "#fff",
                  x: 140,
                  y: 300,
                },
                revealAt: { kind: "cue", cueId: "c1", edge: "start" },
                enter: { motion: "slide-up", durationFrames: 12 },
              },
              {
                id: "r2",
                element: {
                  id: "e2",
                  type: "text",
                  text: "Watch it appear.",
                  fontFamily: "Anton",
                  fontSize: 90,
                  color: "#8B5CF6",
                  x: 140,
                  y: 600,
                },
                revealAt: { kind: "cue", cueId: "c2", edge: "start" },
                enter: { motion: "wipe-in", durationFrames: 14 },
              },
            ],
          },
        ],
      },
    ],
  },
}

const run: ConcurrencyHold = { role: "run", lane: "run", userId: "U", payer: "user:U", tier: "pro", jobId: "dir-1", leaseId: "run-lease", waitTable: "jobs" }

let gate: ConcurrencyGate
const llmRunning = async () => (await gate.snapshot()).lines.find((l) => l.userId === "U")?.lanes.llm.running ?? 0

/** llmComplete's own slot (lib/llm/router.ts), around a canned answer. */
const routerLike = (texts: string[], running: number[]) => vi.fn((req: LlmRequest) =>
  withConcurrencySlot(llmSlot(req, resolveModel(req)), async () => {
    running.push(await llmRunning())
    return { text: texts.shift()!, usage: {} }
  }))

beforeEach(async () => {
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.subscribed = []
  resetLaneCountersForTests()
  resetConcurrencySlotsForTests()
  await gate.setEnforced(true)
})
afterEach(() => vi.restoreAllMocks())

const author = (llm: unknown) => authorShotSequence({ genre: "explainer", brief: "x", userId: "U", tier: "pro", llm: llm as never })

describe("director authoring and the llm lane", () => {
  it("director authoring takes an llm slot", async () => {
    const running: number[] = []
    const llm = routerLike([JSON.stringify(GOOD)], running)
    const acquire = vi.spyOn(gate, "acquire")
    const r = await runHolding(run, () => author(llm))
    expect(r.voScript).toBe(GOOD.voScript)
    // One acquire: the router's own slot ran inside the authoring slot.
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "front", meta: { lane: "llm", jobType: "video-director-author", queue: "inline", userId: "U" } })
    expect(running).toEqual([1])
    expect(await llmRunning()).toBe(0)
  })

  it("a correction round takes a second slot, one per call", async () => {
    const running: number[] = []
    const llm = routerLike(["not json", JSON.stringify(GOOD)], running)
    const acquire = vi.spyOn(gate, "acquire")
    await runHolding(run, () => author(llm))
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(running).toEqual([1, 1])
  })

  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    await gate.acquire({
      meta: { jobId: "other", userId: "U", payer: "user:U", lane: "llm", provider: null, source: null, sourceDetail: null, jobType: "x", model: null, queue: "video-generation", bullJobId: null },
      size: 1, mode: "fresh", leaseTtlMs: 3_600_000,
    })
    const bare = await author(vi.fn().mockResolvedValue({ text: JSON.stringify(GOOD), usage: {} }))
    const held = await runHolding(run, () => author(vi.fn().mockResolvedValue({ text: JSON.stringify(GOOD), usage: {} })))
    expect(held).toEqual(bare)
    expect(refs.subscribed).toEqual([])
    expect(await llmRunning()).toBe(1)
  })
})
