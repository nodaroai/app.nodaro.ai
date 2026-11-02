// The plugin toolkit's members hold one concurrency slot of their lane for the
// whole member call (toolkit-lanes.ts): every provider / ffmpeg / media / llm
// member of the BUILT toolkit is either wrapped or exempt with a reason, a
// member call's own funnel calls run inside its slot (one acquire, never two),
// a job's leaf slot covers it, and with the lanes off nothing changes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// The member calls run in both modes: where limits can be turned on (test-only,
// takes are waited for) and locked, as this release ships (a take is fired and
// counted, never waited for). Waiting itself is tested on the first only.
const availability = vi.hoisted(() => ({ on: true }))
vi.mock("../../concurrency-lanes/enforcement-available.js", () => ({ get LANES_ENFORCEMENT_AVAILABLE() { return availability.on } }))
import { ConcurrencyGate, type WakeTarget } from "../../concurrency-lanes/gate.js"
import { primaryProviderOfLlm } from "../../concurrency-lanes/provider-of.js"
import type { LaneSizes } from "../../concurrency-lanes/types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../concurrency-lanes/__tests__/fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 1, local: 1, run: 1 } as LaneSizes,
  settings: { queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 },
  subscribed: [] as string[][],
  /** What ran inside each fake provider/ffmpeg/llm body, in order. */
  log: [] as string[],
  /** Set by a fake body: whether a slot of its lane was held while it polled. */
  heldWhilePolling: [] as number[],
}))
vi.mock("../../concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../../concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => refs.sizes,
  laneSettings: async () => refs.settings,
}))
vi.mock("../../concurrency-lanes/wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (queues: string[], _onWake: (t: WakeTarget[]) => Promise<void>) => {
    refs.subscribed.push(queues)
    return () => {}
  },
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn() } }))

// A provider member's body as the real one does it: a billed create through
// the provider egress (its own funnel slot), then a poll (no slot).
vi.mock("../../../providers/kie/video.js", async (importOriginal) => {
  const { providerFetch } = await import("../../../providers/egress.js")
  const { waitsAsJob } = await import("../../concurrency-lanes/coordinator-wait.js")
  class KieVideoProvider {
    async textToVideo(prompt: string, model: string) {
      await providerFetch({ provider: "kie", operation: "jobs.createTask", modelKey: model, body: {}, dimensions: {} }, "https://kie.test/create")
      refs.log.push(`waitsAsJob:${waitsAsJob()}`)
      refs.heldWhilePolling.push(await runningOf("provider"))
      await providerFetch({ provider: "kie", operation: "jobs.recordInfo", modelKey: null, body: {}, dimensions: {} }, "https://kie.test/poll")
      return { url: `https://cdn.test/${prompt}.mp4`, kieTaskId: "task-1" }
    }
  }
  return { ...(await importOriginal<object>()), KieVideoProvider }
})
vi.mock("../../../providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runFfmpeg: vi.fn(async (args: readonly string[]) => {
    refs.heldWhilePolling.push(await runningOf("local"))
    return `ran ${args.join(" ")}`
  }),
}))
// The structured LLM call takes its own llm slot (lib/llm/structured.ts,
// inStructuredSlot: withConcurrencySlot with coversNested) — kept here.
vi.mock("../../llm-client.js", async () => {
  const { withConcurrencySlot } = await import("../../concurrency-lanes/slot.js")
  return {
    llmCompleteStructured: vi.fn(async (req: { modelId: string }) =>
      withConcurrencySlot({ lane: "llm", provider: "kie", jobType: "llm", model: req.modelId, coversNested: true }, async () => {
        refs.heldWhilePolling.push(await runningOf("llm"))
        return { output: { ok: req.modelId } }
      })),
  }
})
vi.mock("../../../providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pollKieTask: vi.fn(async () => ({ resultJson: { resultUrls: ["https://cdn.test/done.mp4"] } })),
}))

const { runHolding, laneCounters, resetLaneCountersForTests } = await import("../../concurrency-lanes/hold.js")
const { resetConcurrencySlotsForTests } = await import("../../concurrency-lanes/slot.js")
const { buildToolkit } = await import("../toolkit.js")
const lanes = await import("../toolkit-lanes.js")
type ConcurrencyHold = import("../../concurrency-lanes/hold.js").ConcurrencyHold
type LeafLane = import("../../concurrency-lanes/leaf-lanes.js").LeafLane

const coordinator: ConcurrencyHold = { role: "coordinator", lane: null, userId: "U", payer: "user:U", tier: "pro", jobId: "job-1", leaseId: null }
const leaf: ConcurrencyHold = { ...coordinator, role: "leaf", lane: "provider", leaseId: "job-1-lease" }

let gate: ConcurrencyGate

async function runningOf(lane: LeafLane): Promise<number> {
  return (await gate.snapshot()).lines.find((l) => l.userId === "U")?.lanes[lane]?.running ?? 0
}

/** Fill the user's `lane` (size 1) with another job. */
async function fill(lane: LeafLane): Promise<string> {
  const r = await gate.acquire({
    meta: { jobId: `other-${lane}`, userId: "U", payer: "user:U", lane, provider: null, source: null, sourceDetail: null, jobType: "x", model: null, queue: "video-generation", bullJobId: null },
    size: 1, mode: "fresh", leaseTtlMs: 3_600_000,
  })
  if (!r.granted) throw new Error("expected a grant")
  return r.leaseId
}

/** Poll until `check` holds (a fired take lands when it lands: never count microtask turns). */
async function until(check: () => Promise<boolean> | boolean): Promise<void> {
  const end = Date.now() + 3_000
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not met in time")
    await new Promise((r) => setTimeout(r, 5))
  }
}
const settle = () => new Promise((r) => setTimeout(r, 20))

beforeEach(async () => {
  availability.on = true
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.sizes = { provider: 1, llm: 1, local: 1, run: 1 }
  refs.settings = { queueTimeoutMs: 60_000, liveWaitLimitMs: 600_000 }
  refs.subscribed = []
  refs.log = []
  refs.heldWhilePolling = []
  resetLaneCountersForTests()
  resetConcurrencySlotsForTests()
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json" } })))
  await gate.setEnforced(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe.each([
  { available: true, mode: "limits available" },
  { available: false, mode: "limits locked (this release)" },
])("toolkit members hold a slot for the whole call ($mode)", ({ available }) => {
  beforeEach(() => {
    availability.on = available
  })

  it("a toolkit provider call inside a coordinator job takes a front slot for the whole member call", async () => {
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    const r = await runHolding(coordinator, () => tk.providers.textToVideo("castle", "kling-3.0", 5, "16:9"))
    expect(r).toEqual({ url: "https://cdn.test/castle.mp4", taskId: "task-1" })
    // ONE acquire for create → poll → result: the egress's own slot ran inside it.
    await until(() => release.mock.calls.length === 1)
    await settle()
    expect(acquire).toHaveBeenCalledTimes(1)
    const call = acquire.mock.calls[0]![0]
    expect(call.mode).toBe("front")
    expect(call.meta).toMatchObject({ lane: "provider", provider: "kie", model: "kling-3.0", jobType: "tk.providers.textToVideo", queue: "inline", userId: "U" })
    expect(call.meta.jobId.startsWith("job-1:call:")).toBe(true)
    // Held through the poll (when the take is waited for; a fired one lands when it lands), released once the member returned.
    if (available) expect(refs.heldWhilePolling).toEqual([1])
    expect(release).toHaveBeenCalledTimes(1)
    expect(release.mock.calls[0]![1]).toBe("completed")
    expect(await runningOf("provider")).toBe(0)
    expect(laneCounters().ungated).toEqual({})
  })

  it("an ffmpeg member and an llm member take one slot of their own lane each", async () => {
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    await runHolding(coordinator, async () => {
      expect(await tk.ffmpeg.runFfmpeg(["-i", "a"])).toBe("ran -i a")
      expect(await tk.llm.completeStructured({ model: "gemini-3.6-flash", prompt: "p" }, {})).toEqual({ ok: "gemini-3.6-flash" })
    })
    await until(() => release.mock.calls.length === 2)
    await settle()
    // The structured call's own llm slot ran inside the member's: two acquires in all, not three.
    expect(acquire.mock.calls.map((c) => [c[0].meta.lane, c[0].meta.jobType, c[0].meta.provider])).toEqual([
      ["local", "tk.ffmpeg.runFfmpeg", "local"],
      // The provider the router would serve it from here: null on an install
      // with no LLM key (CI), "kie" / "google" where one is set.
      ["llm", "tk.llm.completeStructured", primaryProviderOfLlm({ modelId: "gemini-3.6-flash", system: "", messages: [] })],
    ])
    if (available) expect(refs.heldWhilePolling).toEqual([1, 1])
    expect(release).toHaveBeenCalledTimes(2)
    expect(await runningOf("local")).toBe(0)
    expect(await runningOf("llm")).toBe(0)
  })

  it("the same call inside a leaf job does not acquire", async () => {
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    await runHolding(leaf, async () => {
      await tk.providers.textToVideo("castle", "kling-3.0", 5, "16:9")
      await tk.ffmpeg.runFfmpeg(["-i", "a"])
      await tk.llm.completeStructured({ model: "gemini-3.6-flash", prompt: "p" }, {})
    })
    await settle()
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({})
  })

  it("a status-only toolkit member never acquires", async () => {
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    expect(lanes.memberLaneOf(tk.providers.getVideoTaskStatus)).toBeUndefined()
    const r = await runHolding(coordinator, () => tk.providers.getVideoTaskStatus("task-1"))
    expect(r).toEqual({ state: "succeeded", videoUrl: "https://cdn.test/done.mp4" })
    await settle()
    expect(acquire).not.toHaveBeenCalled()
  })

  it("outside any hold a member call is counted once and nothing under it waits as a job", async () => {
    const tk = buildToolkit()
    const acquire = vi.spyOn(gate, "acquire")
    await tk.providers.textToVideo("castle", "kling-3.0", 5, "16:9")
    await settle()
    expect(acquire).not.toHaveBeenCalled()
    // The egress's billed create is part of the member call: not counted again.
    expect(laneCounters().ungated).toEqual({ "tk.providers.textToVideo": 1 })
    // The pass-through hold is no job's: a queue-aware poll under it keeps its plain budget.
    expect(refs.log).toEqual(["waitsAsJob:false"])
  })
})

describe("limits locked (this release): a member call never waits for the gate", () => {
  it("member calls run at once while the gate hangs; each lease is released once, when its take lands", async () => {
    availability.on = false
    let answer!: () => void
    const answered = new Promise<void>((r) => { answer = r })
    const real = gate.acquire.bind(gate)
    const acquire = vi.spyOn(gate, "acquire").mockImplementation(async (req) => {
      await answered
      return real(req)
    })
    const release = vi.spyOn(gate, "release")
    const tk = buildToolkit()
    const results = await runHolding(coordinator, () => Promise.all([
      tk.providers.textToVideo("castle", "kling-3.0", 5, "16:9"),
      tk.ffmpeg.runFfmpeg(["-i", "a"]),
      tk.llm.completeStructured({ model: "gemini-3.6-flash", prompt: "p" }, {}),
    ]))
    expect(results).toEqual([{ url: "https://cdn.test/castle.mp4", taskId: "task-1" }, "ran -i a", { ok: "gemini-3.6-flash" }])
    expect(release).not.toHaveBeenCalled()
    answer()
    await until(() => release.mock.calls.length === 3)
    await settle()
    expect(acquire).toHaveBeenCalledTimes(3)
    expect(release.mock.calls.map((c) => c[0]).sort()).toEqual(acquire.mock.calls.map((c) => c[0].leaseId).sort())
    expect(release).toHaveBeenCalledTimes(3)
    for (const lane of ["provider", "local", "llm"] as const) expect(await runningOf(lane)).toBe(0)
  })
})

describe("every toolkit member is declared", () => {
  const TABLES = {
    providers: lanes.PROVIDER_MEMBER_LANES,
    ffmpeg: lanes.FFMPEG_MEMBER_LANES,
    media: lanes.MEDIA_MEMBER_LANES,
    llm: lanes.LLM_MEMBER_LANES,
  } as const

  it("each member the built toolkit carries is wrapped for its lane, or exempt with a reason", () => {
    const tk = buildToolkit() as unknown as Record<string, Record<string, unknown>>
    const problems: string[] = []
    let wrapped = 0
    for (const section of lanes.LANE_SECTIONS) {
      const table = TABLES[section] as Record<string, { lane?: string; exempt?: string }>
      for (const [name, member] of Object.entries(tk[section]!)) {
        const spec = table[name]
        if (!spec) {
          problems.push(`tk.${section}.${name} is not in its table in toolkit-lanes.ts — give it a lane, or exempt it with the reason`)
          continue
        }
        if (spec.exempt !== undefined) {
          if (!spec.exempt.trim()) problems.push(`tk.${section}.${name} is exempt without a reason`)
          if (lanes.memberLaneOf(member) !== undefined) problems.push(`tk.${section}.${name} is exempt but wrapped`)
          continue
        }
        if (typeof member !== "function") problems.push(`tk.${section}.${name} has a lane but is not a function`)
        else if (lanes.memberLaneOf(member) !== spec.lane) problems.push(`tk.${section}.${name} is not wrapped for lane ${spec.lane}`)
        else wrapped++
      }
    }
    expect(problems).toEqual([])
    // Anti-vacuity: the provider, ffmpeg, media and llm sections are really wrapped.
    expect(wrapped).toBeGreaterThanOrEqual(30)
  })

  it("an error class stays the class (instanceof works)", () => {
    const tk = buildToolkit()
    const e = new tk.providers.YtUrlNotAllowedError("no")
    expect(e).toBeInstanceOf(tk.providers.YtUrlNotAllowedError)
  })
})

describe("with enforcement off", () => {
  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    for (const lane of ["provider", "local", "llm"] as const) await fill(lane)
    const tk = buildToolkit()
    const calls = () => Promise.all([
      tk.providers.textToVideo("castle", "kling-3.0", 5, "16:9"),
      tk.ffmpeg.runFfmpeg(["-i", "a"]),
      tk.llm.completeStructured({ model: "gemini-3.6-flash", prompt: "p" }, {}),
    ])
    const bare = await calls()
    const acquire = vi.spyOn(gate, "acquire")
    const started = Date.now()
    const held = await runHolding(coordinator, calls)
    // Identical results, each lane full yet every acquire granted at once: nothing waited.
    expect(held).toEqual(bare)
    expect(acquire).toHaveBeenCalledTimes(3)
    for (const r of acquire.mock.results) expect(await r.value).toMatchObject({ granted: true })
    expect(refs.subscribed).toEqual([])
    expect(Date.now() - started).toBeLessThan(2_000)
    // Each slot was released: only the three fillers are left.
    for (const lane of ["provider", "local", "llm"] as const) expect(await runningOf(lane)).toBe(1)
  })
})
