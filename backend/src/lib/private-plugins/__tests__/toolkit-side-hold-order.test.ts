// A metered SIDE hold's reading takes its llm slot BEFORE the hold is reserved
// (toolkit-lanes.ts withSideHoldSlot): the side-hold sweep counts its grace
// from the hold's stamps, so the wait for a slot must come before the hold
// exists. A wait that ends leaves no hold; the reading's call then runs in
// that slot (one acquire for reserve + call), freed at settle.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// These tests wait for slots, so they run on the path where limits can be
// turned on (test-only: this release locks them, and a locked take never waits).
vi.mock("../../concurrency-lanes/enforcement-available.js", () => ({ LANES_ENFORCEMENT_AVAILABLE: true }))
import { ConcurrencyGate, type WakeTarget } from "../../concurrency-lanes/gate.js"
import type { LaneSizes } from "../../concurrency-lanes/types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../concurrency-lanes/__tests__/fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 1, local: 1, run: 1 } as LaneSizes,
  settings: { queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 },
  onWake: null as null | ((targets: WakeTarget[]) => Promise<void>),
  /** Every step, in order. */
  log: [] as string[],
  callStartingRefuses: false,
  /** What `side.available()` answers (metered pricing on). */
  available: true,
  /** When set, a metered call waits for it after it starts. */
  meteredBlock: null as Promise<void> | null,
  meteredStarted: 0,
}))
vi.mock("../../concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../../concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => refs.sizes,
  laneSettings: async () => refs.settings,
}))
vi.mock("../../concurrency-lanes/wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (_queues: string[], onWake: (t: WakeTarget[]) => Promise<void>) => {
    refs.onWake = onWake
    return () => {}
  },
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))
vi.mock("../../llm-side-hold.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sideHoldsAvailable: () => refs.available,
  reserveLlmSideHold: vi.fn(async (args: { jobId: string; key: string }) => {
    refs.log.push(`reserve:${await llmRunning()}`)
    return {
      ok: true,
      hold: {
        jobId: args.jobId, usageLogId: "ul-1", chargeId: "frame-check:gemini-3.6-flash", holdCredits: 5, replayed: false,
        callStarting: async () => {
          refs.log.push("callStarting")
          if (refs.callStartingRefuses) throw new Error("hold closed")
        },
        noteSpend: async () => { refs.log.push("noteSpend") },
        settle: async () => {
          refs.log.push("settle")
          return { outcome: "charged", charged: 4, shortfall: 0 }
        },
      },
    }
  }),
}))
// The metered call takes its own llm slot inside (lib/llm/structured.ts does).
vi.mock("../llm-metered.js", async () => {
  const { withConcurrencySlot } = await import("../../concurrency-lanes/slot.js")
  return {
    completeStructuredMetered: vi.fn(async () =>
      withConcurrencySlot({ lane: "llm", provider: "kie", jobType: "llm", model: "m", coversNested: true }, async () => {
        refs.log.push(`call:${await llmRunning()}`)
        refs.meteredStarted++
        if (refs.meteredBlock) await refs.meteredBlock
        return { ok: true, output: { fine: true }, usage: { complete: true } }
      })),
  }
})
// An unrelated (not metered) structured call, with its own inner llm slot.
vi.mock("../../llm-client.js", async () => {
  const { withConcurrencySlot } = await import("../../concurrency-lanes/slot.js")
  return {
    llmCompleteStructured: vi.fn(async () =>
      withConcurrencySlot({ lane: "llm", provider: "kie", jobType: "llm", model: "m", coversNested: true }, async () => {
        refs.log.push(`other:${await llmRunning()}`)
        return { output: { other: true } }
      })),
  }
})

const { runHolding } = await import("../../concurrency-lanes/hold.js")
const { resetConcurrencySlotsForTests } = await import("../../concurrency-lanes/slot.js")
const { LaneWaitTimeoutError } = await import("../../concurrency-lanes/errors.js")
const { reserveLlmSideHold } = await import("../../llm-side-hold.js")
const { buildToolkit } = await import("../toolkit.js")
type ConcurrencyHold = import("../../concurrency-lanes/hold.js").ConcurrencyHold
type PluginToolkit = import("../types.js").PluginToolkit

const coordinator: ConcurrencyHold = { role: "coordinator", lane: null, userId: "U", payer: "user:U", tier: "pro", jobId: "job-1", leaseId: null }

let gate: ConcurrencyGate

async function llmRunning(): Promise<number> {
  return (await gate.snapshot()).lines.find((l) => l.userId === "U")?.lanes.llm.running ?? 0
}

async function fillLlm(): Promise<string> {
  const r = await gate.acquire({
    meta: { jobId: "other", userId: "U", payer: "user:U", lane: "llm", provider: null, source: null, sourceDetail: null, jobType: "x", model: null, queue: "video-generation", bullJobId: null },
    size: 1, mode: "fresh", leaseTtlMs: 3_600_000,
  })
  if (!r.granted) throw new Error("expected a grant")
  return r.leaseId
}

type ReserveArgs = Parameters<NonNullable<NonNullable<PluginToolkit["llmBilling"]>["side"]>["reserve"]>[0]
const reserveArgs: ReserveArgs = {
  jobId: "job-1", userId: "U", feature: "frame-check", key: "take:1",
  calls: [{ modelId: "gemini-3.6-flash", request: { modelId: "gemini-3.6-flash", system: "", messages: [{ role: "user", content: "look" }] } }],
}
const meteredReq = { model: "gemini-3.6-flash", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "look" }] }] }

function side(tk: PluginToolkit) {
  return tk.llmBilling!.side!
}

beforeEach(async () => {
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.sizes = { provider: 1, llm: 1, local: 1, run: 1 }
  refs.settings = { queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 }
  refs.onWake = null
  refs.log = []
  refs.callStartingRefuses = false
  refs.available = true
  refs.meteredBlock = null
  refs.meteredStarted = 0
  resetConcurrencySlotsForTests()
  vi.mocked(reserveLlmSideHold).mockClear()
  await gate.setEnforced(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("a metered side hold and its llm slot", () => {
  it("the side hold opens after the llm slot is granted", async () => {
    vi.useFakeTimers()
    const other = await fillLlm()
    const tk = buildToolkit()
    await runHolding(coordinator, async () => {
      let reserved = false
      const p = side(tk).reserve(reserveArgs).then((r) => { reserved = true; return r })
      // The llm lane is full: the reading waits for its slot, and no hold exists yet.
      await vi.advanceTimersByTimeAsync(1_000)
      expect(reserved).toBe(false)
      expect(reserveLlmSideHold).not.toHaveBeenCalled()
      // The slot frees: granted first, the hold reserved after (in the slot).
      await refs.onWake!(await gate.release(other, "completed"))
      await vi.advanceTimersByTimeAsync(0)
      const r = await p
      expect(r.ok).toBe(true)
      if (r.ok) await r.hold.settle(tk.llmBilling!.newSpend())
    })
    expect(refs.log).toEqual(["reserve:1", "settle"])
    expect(await llmRunning()).toBe(0)
  })

  it("a refusal while waiting leaves no side hold open", async () => {
    vi.useFakeTimers()
    await fillLlm()
    refs.settings = { queueTimeoutMs: 2_000, liveWaitLimitMs: 600_000 }
    const tk = buildToolkit()
    let err: unknown
    await runHolding(coordinator, async () => {
      const p = side(tk).reserve(reserveArgs).catch((e: unknown) => { err = e })
      await vi.advanceTimersByTimeAsync(5_000)
      await p
    })
    expect(err).toBeInstanceOf(LaneWaitTimeoutError)
    expect(reserveLlmSideHold).not.toHaveBeenCalled()
    // Only the job that filled the lane holds it; the reading's entry is gone.
    const llm = (await gate.snapshot()).lines.find((l) => l.userId === "U")?.lanes.llm
    expect(llm).toMatchObject({ running: 1, queued: 0 })
  })

  it("reserve and the metered call take one slot, held until the settle", async () => {
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    await runHolding(coordinator, async () => {
      const r = await side(tk).reserve(reserveArgs)
      if (!r.ok) throw new Error("expected a hold")
      await r.hold.callStarting()
      const out = await tk.llm.completeStructuredMetered!(meteredReq, {})
      expect(out).toMatchObject({ ok: true, output: { fine: true } })
      await r.hold.noteSpend(tk.llmBilling!.newSpend())
      expect(await llmRunning()).toBe(1)
      await r.hold.settle(tk.llmBilling!.newSpend())
      expect(await llmRunning()).toBe(0)
    })
    expect(refs.log).toEqual(["reserve:1", "callStarting", "call:1", "noteSpend", "settle"])
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "front", meta: { lane: "llm", jobType: "tk.llmBilling.side.frame-check", model: "gemini-3.6-flash", queue: "inline" } })
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("a refused call start frees the slot; so does the end of the job", async () => {
    const tk = buildToolkit()
    refs.callStartingRefuses = true
    await runHolding(coordinator, async () => {
      const r = await side(tk).reserve(reserveArgs)
      if (!r.ok) throw new Error("expected a hold")
      await expect(r.hold.callStarting()).rejects.toThrow("hold closed")
      expect(await llmRunning()).toBe(0)
    })
    refs.callStartingRefuses = false
    await runHolding(coordinator, async () => {
      const r = await side(tk).reserve(reserveArgs)
      expect(r.ok).toBe(true)
      expect(await llmRunning()).toBe(1)
      // Never settled by the plugin.
    })
    await vi.waitFor(async () => expect(await llmRunning()).toBe(0))
  })

  it("a malformed reserve is still refused as an answer, and takes no slot", async () => {
    const refusal = { ok: false, code: "invalid_request", message: "A side hold needs its planned calls: a non-empty list, each naming its model" }
    vi.mocked(reserveLlmSideHold).mockResolvedValueOnce(refusal as never)
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    const r = await runHolding(coordinator, () => side(tk).reserve({ ...reserveArgs, calls: [] as unknown as ReserveArgs["calls"] }))
    expect(r).toEqual(refusal)
    expect(acquire).not.toHaveBeenCalled()
  })

  it("under the job's own leaf slot nothing is taken", async () => {
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    await runHolding({ ...coordinator, role: "leaf", lane: "provider", leaseId: "job-lease" }, async () => {
      const r = await side(tk).reserve(reserveArgs)
      if (!r.ok) throw new Error("expected a hold")
      await tk.llm.completeStructuredMetered!(meteredReq, {})
      await r.hold.settle(tk.llmBilling!.newSpend())
    })
    expect(acquire).not.toHaveBeenCalled()
  })

  it("with enforcement off the reading is granted at once over a full lane", async () => {
    await gate.setEnforced(false)
    await fillLlm()
    const tk = buildToolkit()
    await runHolding(coordinator, async () => {
      const r = await side(tk).reserve(reserveArgs)
      if (!r.ok) throw new Error("expected a hold")
      await r.hold.settle(tk.llmBilling!.newSpend())
    })
    expect(refs.log).toEqual(["reserve:2", "settle"])
    expect(await llmRunning()).toBe(1)
  })

  it("an unrelated LLM call never runs in a reading's slot", async () => {
    refs.sizes = { ...refs.sizes, llm: 2 }
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    await runHolding(coordinator, async () => {
      const r = await side(tk).reserve(reserveArgs)
      if (!r.ok) throw new Error("expected a hold")
      // Between the reserve and the reading's call: an unrelated call takes its own slot.
      expect(await tk.llm.completeStructured({ model: "gemini-3.6-flash", prompt: "p" }, {})).toEqual({ other: true })
      await r.hold.callStarting()
      await tk.llm.completeStructuredMetered!(meteredReq, {})
      await r.hold.settle(tk.llmBilling!.newSpend())
    })
    // The unrelated call ran beside the reading's idle slot (2); the reading ran in its own slot (1).
    expect(refs.log).toEqual(["reserve:1", "other:2", "callStarting", "call:1", "settle"])
    expect(acquire.mock.calls.map((c) => c[0].meta.jobType)).toEqual(["tk.llmBilling.side.frame-check", "tk.llm.completeStructured"])
    expect(await llmRunning()).toBe(0)
  })

  it("two overlapping readings in one job each run in their own slot", async () => {
    refs.sizes = { ...refs.sizes, llm: 2 }
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    let open = () => {}
    refs.meteredBlock = new Promise<void>((resolve) => { open = resolve })
    await runHolding(coordinator, async () => {
      const a = await side(tk).reserve({ ...reserveArgs, key: "take:1" })
      const b = await side(tk).reserve({ ...reserveArgs, key: "take:2" })
      if (!a.ok || !b.ok) throw new Error("expected two holds")
      const calls = [tk.llm.completeStructuredMetered!(meteredReq, {}), tk.llm.completeStructuredMetered!(meteredReq, {})]
      await vi.waitFor(() => expect(refs.meteredStarted).toBe(2))
      // Both readings run at once, each in a slot of its own: two held, none more.
      expect(await llmRunning()).toBe(2)
      open()
      await Promise.all(calls)
      await a.hold.settle(tk.llmBilling!.newSpend())
      expect(await llmRunning()).toBe(1)
      await b.hold.settle(tk.llmBilling!.newSpend())
    })
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(await llmRunning()).toBe(0)
  })

  it("a settle while the reading still runs frees the slot only when it ends", async () => {
    const tk = buildToolkit()
    const release = vi.spyOn(gate, "release")
    let open = () => {}
    refs.meteredBlock = new Promise<void>((resolve) => { open = resolve })
    await runHolding(coordinator, async () => {
      const r = await side(tk).reserve(reserveArgs)
      if (!r.ok) throw new Error("expected a hold")
      const call = tk.llm.completeStructuredMetered!(meteredReq, {})
      await vi.waitFor(() => expect(refs.meteredStarted).toBe(1))
      await r.hold.settle(tk.llmBilling!.newSpend())
      // Never freed under a running call.
      expect(release).not.toHaveBeenCalled()
      expect(await llmRunning()).toBe(1)
      open()
      await call
    })
    expect(release).toHaveBeenCalledTimes(1)
    expect(await llmRunning()).toBe(0)
  })

  it("with metered pricing off a reserve takes no slot", async () => {
    refs.available = false
    await fillLlm()
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    await runHolding(coordinator, () => side(tk).reserve(reserveArgs))
    expect(acquire).not.toHaveBeenCalled()
    expect(reserveLlmSideHold).toHaveBeenCalledTimes(1)
  })

  it("the slot is the job's: a nested scope of the same job finds it", async () => {
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    await runHolding(coordinator, async () => {
      const r = await side(tk).reserve(reserveArgs)
      if (!r.ok) throw new Error("expected a hold")
      // A nested coordinator scope of the same job (one in-handler wait).
      await runHolding({ ...coordinator }, () => tk.llm.completeStructuredMetered!(meteredReq, {}))
      await r.hold.settle(tk.llmBilling!.newSpend())
    })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(refs.log).toEqual(["reserve:1", "call:1", "settle"])
  })
})
