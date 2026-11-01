/**
 * Concurrency lanes: a workflow's sync-HTTP node waits for its route's slot in
 * the ORCHESTRATOR, under the run's hold and the queue timeout — never at the
 * route under the live-wait limit (decided 2026-10-30: a workflow never fails
 * with `lane_busy`; nothing fails for waiting). The node's own
 * `NODE_TIMEOUT_MS` starts once the slot is held, the wait grows the run's
 * `ctx.laneWaitMs`, and the node shows `queueInfo` while it waits. The request
 * names the slot (LANE_LEASE_HEADER) and the route runs under it: one slot
 * per node run.
 *
 * Harness: the real dispatch and the real slot code over the fake lane store
 * (fake-lane-redis.ts); only Supabase, credits and the HTTP hop are stood in
 * for — except in the acquire-count case, where the hop is a real request to a
 * real Fastify app running the request scope and the route's own guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// These tests wait for slots, so they run on the path where limits can be
// turned on (test-only: this release locks them, and a locked take never
// waits) — except where a case turns `refs.available` off.
vi.mock("../../../lib/concurrency-lanes/enforcement-available.js", () => ({ get LANES_ENFORCEMENT_AVAILABLE() { return refs.available } }))
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import type { AddressInfo } from "node:net"
import type { WakeTarget } from "../../../lib/concurrency-lanes/gate.js"
import type { LaneSizes } from "../../../lib/concurrency-lanes/types.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 1, local: 2, run: 2 } as LaneSizes,
  settings: { queueTimeoutMs: 2 * 3_600_000, liveWaitLimitMs: 600_000 },
  onWake: null as null | ((targets: WakeTarget[]) => Promise<void>),
  available: true,
  /** When set, the lane settings and sizes do not answer until it settles: a Redis that hangs. */
  hang: null as Promise<void> | null,
}))
vi.mock("../../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../../../lib/concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => { if (refs.hang) await refs.hang; return refs.sizes },
  laneSettings: async () => { if (refs.hang) await refs.hang; return refs.settings },
  lanesEnforced: async () => false,
}))
vi.mock("../../../lib/concurrency-lanes/wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (_queues: string[], onWake: (targets: WakeTarget[]) => Promise<void>) => {
    refs.onWake = onWake
    return () => undefined
  },
}))

const db = vi.hoisted(() => ({
  /** The row every status poll reads. */
  jobRecord: {} as Record<string, unknown>,
  jobUpdates: [] as Array<Record<string, unknown>>,
  /** What a read of the execution's status answers, and how long it takes. */
  executionStatus: "running",
  executionReadMs: 0,
}))
vi.mock("../../../lib/supabase.js", () => {
  function builder(table: string) {
    let op: "select" | "insert" | "update" | null = null
    let columns = ""
    const b: Record<string, unknown> = {}
    b.select = (c?: string) => { if (op === null) { op = "select"; columns = c ?? "" } return b }
    for (const m of ["eq", "in", "not", "order", "limit", "is", "neq", "lt", "gt"]) b[m] = () => b
    b.insert = () => { op = "insert"; return b }
    b.update = (patch: Record<string, unknown>) => { op = "update"; if (table === "jobs") db.jobUpdates.push(patch); return b }
    const one = () => {
      if (table === "jobs" && columns === "input_data") return { data: { input_data: {} }, error: null }
      if (table === "jobs") return { data: db.jobRecord, error: null }
      return { data: { status: "running" }, error: null }
    }
    b.single = async () => {
      if (table === "workflow_executions" && db.executionReadMs > 0) await new Promise((r) => setTimeout(r, db.executionReadMs))
      return table === "workflow_executions" ? { data: { status: db.executionStatus }, error: null } : one()
    }
    b.maybeSingle = async () => one()
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res, rej)
    return b
  }
  return { supabase: { from: (table: string) => builder(table) } }
})
vi.mock("../../../ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
  getModelCreditBaseCost: vi.fn(async () => ({ creditCost: 10 })),
}))
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: vi.fn().mockResolvedValue({ cost_markup_percent: 0 }) }))

/** The HTTP hop. Each test says how it answers; `real` sends it for real. */
const hop = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown>; at: number }>,
  answer: (_url: string): Record<string, unknown> => ({ text: "an answer" }),
  real: false,
}))
vi.mock("../loopback-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../loopback-fetch.js")>()
  return {
    ...actual,
    loopbackFetch: async (url: string, init: RequestInit, opts: Parameters<typeof actual.loopbackFetch>[2]) => {
      hop.calls.push({
        url,
        headers: { ...(init.headers as Record<string, string>) },
        body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>,
        at: Date.now(),
      })
      if (hop.real) return actual.loopbackFetch(url, init, opts)
      return new Response(JSON.stringify(hop.answer(url)), { status: 200, headers: { "content-type": "application/json" } })
    },
  }
})

const { ConcurrencyGate } = await import("../../../lib/concurrency-lanes/gate.js")
const { makeFakeLaneClient, makeFakeLaneStore } = await import("../../../lib/concurrency-lanes/__tests__/fake-lane-redis.js")
const { runHolding, resetLaneCountersForTests } = await import("../../../lib/concurrency-lanes/hold.js")
const { resetConcurrencySlotsForTests, withConcurrencySlot } = await import("../../../lib/concurrency-lanes/slot.js")
const { installLaneRequestScope, laneGuard, LANE_LEASE_HEADER } = await import("../../../lib/concurrency-lanes/request-scope.js")
const { syncRouteLane, syncRouteLaneDecision } = await import("../../../lib/concurrency-lanes/sync-route-lanes.js")
const { executeNode, ROUTE_LANES, buildSyncHttpBody } = await import("../node-executor.js")
const { NODE_TIMEOUT_MS } = await import("../types.js")
type ConcurrencyHold = import("../../../lib/concurrency-lanes/hold.js").ConcurrencyHold
type OrchestratorContext = import("../types.js").OrchestratorContext
type SimpleNode = import("../types.js").SimpleNode
type NodeQueueInfo = import("../types.js").NodeQueueInfo

const MINUTE = 60_000
const USER = "U"
const RUN_HOLD: ConcurrencyHold = { role: "run", lane: "run", userId: USER, payer: `user:${USER}`, tier: null, jobId: "exec-1", leaseId: "run-lease" }

let gate: InstanceType<typeof ConcurrencyGate>

const llmNode = (): SimpleNode => ({ id: "llm", type: "llm-chat", data: { userInput: "Write a line.", systemPrompt: "" } })
const scrapeNode = (actor = "google-search"): SimpleNode => ({ id: "scrape", type: "web-scrape", data: { actor, query: "cats", url: "https://example.com/feed.xml" } })
const siteCaptureNode = (): SimpleNode => ({ id: "site", type: "site-capture", data: { url: "https://example.com" } })

function makeCtx(): OrchestratorContext & { queued: Array<NodeQueueInfo | null> } {
  const queued: Array<NodeQueueInfo | null> = []
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: USER,
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    billingContext: { payer: "user", userId: USER },
    onJobCreated: vi.fn(),
    onNodeQueued: (_nodeId: string, q: NodeQueueInfo | null) => { queued.push(q) },
    queued,
  } as unknown as OrchestratorContext & { queued: Array<NodeQueueInfo | null> }
}

/** Fill the user's `lane` with work of its own (a long lease); returns the lease. */
async function fill(lane: "llm" | "provider"): Promise<string> {
  const r = await gate.acquire({
    meta: { jobId: `filler-${lane}`, userId: USER, payer: `user:${USER}`, lane, provider: "kie", source: null, sourceDetail: null,
      jobType: "image-to-video", model: null, queue: "video-generation", bullJobId: `filler-${lane}` },
    size: refs.sizes[lane], mode: "fresh", leaseTtlMs: 4 * 3_600_000,
  })
  if (!r.granted) throw new Error("expected a grant")
  return r.leaseId
}

function run(node: SimpleNode, ctx: OrchestratorContext, hold: ConcurrencyHold | null = RUN_HOLD) {
  const settled: Array<{ ok: boolean; value: unknown }> = []
  const exec = () => executeNode(node, {}, [], [node], {}, ctx)
  const done = (hold ? runHolding(hold, exec) : exec()).then(
    (v) => { settled.push({ ok: true, value: v }) },
    (e) => { settled.push({ ok: false, value: e }) },
  )
  return { settled, done }
}

/** Advance fake time in re-check-sized bites so the wait actually re-checks. */
async function advance(ms: number): Promise<void> {
  const STEP = 5_000
  for (let left = ms; left > 0; left -= STEP) await vi.advanceTimersByTimeAsync(Math.min(STEP, left))
}

/** The times AbortSignal.timeout(NODE_TIMEOUT_MS) was made — the node's own clock starting. */
let nodeClockStarts: number[]

beforeEach(async () => {
  const store = makeFakeLaneStore()
  // Read the clock late: a case may install fake timers after this.
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store), now: () => Date.now() })
  refs.gate = gate
  refs.sizes = { provider: 1, llm: 1, local: 2, run: 2 }
  refs.onWake = null
  refs.available = true
  refs.hang = null
  hop.calls = []
  hop.answer = () => ({ text: "an answer" })
  hop.real = false
  db.jobRecord = {}
  db.jobUpdates = []
  db.executionStatus = "running"
  db.executionReadMs = 0
  resetLaneCountersForTests()
  resetConcurrencySlotsForTests()
  await gate.setEnforced(true)
  nodeClockStarts = []
  const realTimeout = AbortSignal.timeout.bind(AbortSignal)
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    if (ms === NODE_TIMEOUT_MS) nodeClockStarts.push(Date.now())
    return realTimeout(ms)
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("the lane of each sync node comes from its route's rule", () => {
  it("ROUTE_LANES is filled without any route registered (the orchestrator process registers none)", () => {
    expect(ROUTE_LANES.get("llm-chat")).toBe("llm")
    expect(ROUTE_LANES.get("web-scrape")).toBe("provider")
    expect(ROUTE_LANES.has("site-capture")).toBe(false)
  })

  it("an rss scrape takes no provider slot: the same decision the route's guard makes", () => {
    const ctx = makeCtx()
    const rss = buildSyncHttpBody(scrapeNode("rss"), {}, ctx)
    const search = buildSyncHttpBody(scrapeNode(), {}, ctx)
    expect(syncRouteLaneDecision("/v1/web-scrape", rss)).toBeNull()
    expect(syncRouteLaneDecision("/v1/web-scrape", search)).toEqual({ lane: "provider", provider: "apify" })
  })
})

describe("a workflow sync node waits in the orchestrator", () => {
  for (const [what, node, lane, route] of [
    ["llm", llmNode, "llm", "/v1/llm-chat/generate"],
    ["web-scrape", () => scrapeNode(), "provider", "/v1/web-scrape"],
  ] as const) {
    const title = what === "llm"
      ? "a workflow llm node that waits 30 min for an llm slot runs and the run does not fail"
      : "a workflow web-scrape node that waits 30 min runs and the run does not fail"
    it(title, async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
      const filler = await fill(lane)
      const ctx = makeCtx()
      const acquire = vi.spyOn(gate, "acquire")
      const { settled, done } = run(node(), ctx)
      await advance(30 * MINUTE)
      // Still waiting after 30 minutes: no call made, the node's clock not started, nothing failed.
      expect(settled).toHaveLength(0)
      expect(hop.calls).toHaveLength(0)
      expect(nodeClockStarts).toHaveLength(0)
      // The node shows where it stands, in its own lane, at the front of the run's line.
      const shown = ctx.queued.filter((q): q is NodeQueueInfo => q !== null)
      expect(shown.length).toBeGreaterThan(300)
      expect(shown.at(-1)).toMatchObject({ lane, position: 1, limit: 1, running: 1, reason: "user_lane" })
      expect(shown.at(-1)!.waitedSeconds).toBeGreaterThanOrEqual(29 * 60)
      expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "front", meta: { lane, queue: "inline", jobType: node().type } })
      // The run already leaves the wait out while it lasts.
      expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(29 * MINUTE)

      const freedAt = Date.now()
      await gate.release(filler, "completed")
      await advance(10_000)
      await done
      expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
      // The call went out once the slot was held, naming it; the node's clock started there, not before.
      expect(hop.calls).toHaveLength(1)
      expect(hop.calls[0]!.url).toContain(route)
      expect(hop.calls[0]!.at).toBeGreaterThanOrEqual(freedAt)
      expect(hop.calls[0]!.headers[LANE_LEASE_HEADER]).toEqual(expect.any(String))
      expect(nodeClockStarts).toHaveLength(1)
      expect(nodeClockStarts[0]!).toBeGreaterThanOrEqual(freedAt)
      // The wait is the run's queued time, and the node no longer shows a queue.
      expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(30 * MINUTE)
      expect(ctx.laneWaitMs).toBeLessThanOrEqual(31 * MINUTE)
      expect(ctx.queued.at(-1)).toBeNull()
      // The slot was held for the hop only: released once the call answered.
      expect((await gate.snapshot()).lines.find((l) => l.userId === USER)?.lanes[lane].running ?? 0).toBe(0)
    }, 60_000)
  }

  it("an rss web-scrape node takes no provider slot and never waits for one", async () => {
    await fill("provider")
    const ctx = makeCtx()
    const acquire = vi.spyOn(gate, "acquire")
    const { settled, done } = run(scrapeNode("rss"), ctx)
    await done
    expect(settled[0]!.ok).toBe(true)
    expect(acquire).not.toHaveBeenCalled()
    expect(hop.calls[0]!.headers[LANE_LEASE_HEADER]).toBeUndefined()
    expect(ctx.queued).toEqual([])
  })

  it("a cancelled run ends the node's wait as cancelled, with no call made", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
    await fill("llm")
    const ctx = makeCtx()
    const { settled, done } = run(llmNode(), ctx)
    await advance(MINUTE)
    ctx.cancelled = true
    await advance(10_000)
    await done
    expect(settled[0]!.ok).toBe(false)
    expect((settled[0]!.value as Error).message).toBe("Execution cancelled")
    expect(hop.calls).toHaveLength(0)
    expect(ctx.queued.at(-1)).toBeNull()
    // Its place in line is given up.
    expect((await gate.snapshot()).lines.find((l) => l.userId === USER)?.lanes.llm.queued ?? 0).toBe(0)
  }, 30_000)

  it("a queue report that throws never fails the node, never stops its hop and never keeps its slot", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
    const filler = await fill("llm")
    const ctx = makeCtx()
    let reports = 0
    ctx.onNodeQueued = () => {
      reports++
      throw new Error("the run's report failed")
    }
    const { settled, done } = run(llmNode(), ctx)
    await advance(MINUTE)
    await gate.release(filler, "completed")
    await advance(10_000)
    await done
    expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
    // Every check reported, and so did the grant (its null threw too): the hop still ran, once.
    expect(reports).toBeGreaterThan(10)
    expect(hop.calls).toHaveLength(1)
    expect(hop.calls[0]!.headers[LANE_LEASE_HEADER]).toEqual(expect.any(String))
    expect((await gate.snapshot()).lines.find((l) => l.userId === USER)?.lanes.llm.running ?? 0).toBe(0)
  }, 30_000)

  it("a cancelled wait whose final report throws still ends as cancelled", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
    await fill("llm")
    const ctx = makeCtx()
    ctx.onNodeQueued = (_id, q) => {
      if (q === null) throw new Error("the run's report failed")
    }
    const { settled, done } = run(llmNode(), ctx)
    await advance(MINUTE)
    ctx.cancelled = true
    await advance(10_000)
    await done
    expect(settled[0]!.ok).toBe(false)
    expect((settled[0]!.value as Error).message).toBe("Execution cancelled")
    expect(hop.calls).toHaveLength(0)
  }, 30_000)

  it("a wait a cancel ends between two checks is credited to the run up to its end", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
    await fill("llm")
    // The cancel is learned from the execution's row, 2 s after a check asked (mid-wait).
    db.executionStatus = "cancelled"
    db.executionReadMs = 2_000
    const ctx = makeCtx()
    const startedAt = Date.now()
    let endedAt = 0
    const done = runHolding(RUN_HOLD, () => executeNode(llmNode(), {}, [], [llmNode()], {}, ctx)).then(
      () => { endedAt = Date.now() },
      (err: Error) => { endedAt = Date.now(); expect(err.message).toBe("Execution cancelled") },
    )
    await advance(2 * MINUTE)
    await done
    expect(endedAt).toBeGreaterThan(startedAt)
    expect(hop.calls).toHaveLength(0)
    // Not only up to the last check: the whole wait, to the moment it ended.
    expect(ctx.laneWaitMs).toBe(endedAt - startedAt)
    expect(ctx.queued.at(-1)).toBeNull()
  }, 30_000)

  it("a workflow site-capture node whose job waits 30 min as queued runs and the run does not fail", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
    await fill("provider")
    hop.answer = () => ({ jobId: "job-site", status: "pending" })
    db.jobRecord = { status: "queued", output_data: null, error_message: null, progress: 0 }
    const ctx = makeCtx()
    const acquire = vi.spyOn(gate, "acquire")
    const { settled, done } = run(siteCaptureNode(), ctx)
    await advance(30 * MINUTE)
    expect(settled).toHaveLength(0)
    // It answered with a job id at once: the orchestrator took no slot for it (its worker job waits for its own).
    expect(hop.calls).toHaveLength(1)
    expect(hop.calls[0]!.headers[LANE_LEASE_HEADER]).toBeUndefined()
    expect(acquire).not.toHaveBeenCalled()
    db.jobRecord = { status: "processing", output_data: null, error_message: null, progress: 50 }
    await advance(MINUTE)
    db.jobRecord = { status: "completed", output_data: { pageUrl: "https://example.com", stills: [] }, error_message: null, progress: 100, credits_actual: 2 }
    await advance(MINUTE)
    await done
    expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
    expect(ctx.laneWaitMs).toBeGreaterThanOrEqual(29 * MINUTE)
  }, 60_000)
})

describe("one slot per node run", () => {
  let server: FastifyInstance
  let port: string | undefined
  /** What the route's handler ran under. */
  let routeHold: ConcurrencyHold | undefined

  beforeEach(async () => {
    server = Fastify()
    installLaneRequestScope(server)
    // A stand-in for the auth hook's internal lane: the orchestrator's secret header, the user it names.
    server.addHook("preHandler", async (req: FastifyRequest) => {
      if (req.headers["x-internal-orchestrator-secret"] !== undefined) {
        req.authKind = "internal"
        req.userId = String(req.headers["x-internal-user-id"])
      }
    })
    // The route as the real one guards it (its rule), and an LLM call through the funnel as its handler makes.
    server.post("/v1/llm-chat/generate", { preHandler: laneGuard(...syncRouteLane("/v1/llm-chat/generate")) }, async () => {
      const { currentConcurrencyHold } = await import("../../../lib/concurrency-lanes/hold.js")
      routeHold = currentConcurrencyHold()
      return withConcurrencySlot({ lane: "llm", provider: "kie", jobType: "llm-chat" }, async () => ({ text: "an answer" }))
    })
    await server.listen({ port: 0, host: "127.0.0.1" })
    port = process.env.BACKEND_PORT
    process.env.BACKEND_PORT = String((server.server.address() as AddressInfo).port)
    hop.real = true
    routeHold = undefined
  })
  afterEach(async () => {
    if (port === undefined) delete process.env.BACKEND_PORT
    else process.env.BACKEND_PORT = port
    await server.close()
  })

  it("a workflow llm node takes exactly one slot: the orchestrator's, which the route runs under", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const ctx = makeCtx()
    const { settled, done } = run(llmNode(), ctx)
    await done
    expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "front", meta: { lane: "llm", queue: "inline", jobType: "llm-chat" } })
    expect(routeHold).toMatchObject({ role: "leaf", lane: "llm", leaseId: hop.calls[0]!.headers[LANE_LEASE_HEADER] })
  })

  it("limits locked: the hop goes at once while the gate hangs, names the slot its take asked for, and the route adopts it without asking the gate — one slot, released once", async () => {
    refs.available = false
    let unhang!: () => void
    refs.hang = new Promise<void>((r) => { unhang = r })
    const acquire = vi.spyOn(gate, "acquire")
    const leaseLine = vi.spyOn(gate, "leaseLine")
    const release = vi.spyOn(gate, "release")
    const ctx = makeCtx()
    const { settled, done } = run(llmNode(), ctx)
    await done
    expect(settled[0]!.ok, String((settled[0]!.value as Error)?.message)).toBe(true)
    const named = hop.calls[0]!.headers[LANE_LEASE_HEADER]
    expect(named).toEqual(expect.any(String))
    expect(routeHold).toMatchObject({ role: "leaf", lane: "llm", leaseId: named })
    expect(leaseLine).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled() // the node ran before the gate was asked
    expect(ctx.queued).toEqual([])
    unhang()
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "front", leaseId: named, meta: { lane: "llm", queue: "inline" } })
    expect(release).toHaveBeenCalledWith(named, "completed")
    await new Promise((r) => setTimeout(r, 20))
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("control: the same hop without the lease header takes a second slot at the route", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const { settled, done } = run(llmNode(), makeCtx(), null)
    await done
    expect(settled[0]!.ok).toBe(true)
    // No run hold: the orchestrator's call ran ungated (no lease), so the route took its own live slot.
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "fresh", meta: { queue: "live" } })
  })
})

describe("enforcement off", () => {
  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    await fill("llm")
    await fill("provider")
    for (const node of [llmNode(), scrapeNode()]) {
      // The same node run with no hold at all: what it answered before lanes.
      const before = run(node, makeCtx(), null)
      await before.done
      const ctx = makeCtx()
      const t0 = Date.now()
      const under = run(node, ctx)
      await under.done
      expect(under.settled[0]!.ok, node.type).toBe(true)
      expect(under.settled[0]!.value, node.type).toEqual(before.settled[0]!.value)
      // Nothing waited, nothing was shown, the run's clocks are untouched.
      expect(Date.now() - t0, node.type).toBeLessThan(2_000)
      expect(ctx.queued, node.type).toEqual([])
      expect("laneWaitMs" in ctx, node.type).toBe(false)
      // The same request went out (plus the slot it names: granted over the limit, only measured).
      const [a, b] = hop.calls.slice(-2)
      expect(b!.body, node.type).toEqual(a!.body)
      const { [LANE_LEASE_HEADER]: lease, ...rest } = b!.headers
      expect(rest, node.type).toEqual(a!.headers)
      expect(lease, node.type).toEqual(expect.any(String))
    }
  })
})
