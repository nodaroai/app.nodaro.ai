// The request scope and the two funnels: every route handler runs in a request
// scope, a funnel call inside it takes one slot for the rest of the request
// (live, under the live-wait limit capped per transport), a request made
// in-process inherits its caller's hold, and with enforcement off nothing ever
// waits or is refused.
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import Replicate from "replicate"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate, type WakeTarget } from "../gate.js"
import type { LaneSizes } from "../types.js"
import { makeFakeLaneClient, makeFakeLaneStore, type FakeLaneStore } from "./fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 2, local: 2, run: 1 } as LaneSizes,
  settings: { queueTimeoutMs: 3_600_000, liveWaitLimitMs: 600_000 },
  onWake: null as null | ((targets: WakeTarget[]) => Promise<void>),
  /** Whether limits may be turned on (this release: no). These tests wait, so they default to the test-only "yes". */
  available: true,
  /** When set, the lane settings and sizes do not answer until it settles: a Redis that hangs. */
  hang: null as Promise<void> | null,
}))
vi.mock("../enforcement-available.js", () => ({ get LANES_ENFORCEMENT_AVAILABLE() { return refs.available } }))
vi.mock("../instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../sizes.js", () => ({
  laneSizesFor: async () => { if (refs.hang) await refs.hang; return refs.sizes },
  laneSettings: async () => { if (refs.hang) await refs.hang; return refs.settings },
}))
vi.mock("../wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (_queues: string[], onWake: (targets: WakeTarget[]) => Promise<void>) => {
    refs.onWake = onWake
    return () => undefined
  },
}))

const { runHolding, runNotLimited, laneCounters, resetLaneCountersForTests, currentConcurrencyHold } = await import("../hold.js")
const { resetConcurrencySlotsForTests, liveWaitLimitMs } = await import("../slot.js")
const { registerLiveWaitExpiryRecorder, resetHistoryHooksForTests } = await import("../history-hooks.js")
const { LaneWaitAbortedError } = await import("../errors.js")
const {
  installLaneRequestScope, laneGuard, acquireLiveLane, laneOfRoute, laneRuleOfRoute, LANE_LEASE_HEADER, LANE_PARENT_HEADER,
} = await import("../request-scope.js")
const { LANE_PARENT_HEADER: PARENT_HEADER_AT_HOME } = await import("../lane-parent.js")
const { providerFetch, egressSdkFetch } = await import("../../../providers/egress.js")
const { createsReplicatePrediction } = await import("../../../providers/replicate/client.js")
const { createsFalRun } = await import("../../../providers/fal/client.js")
const { llmComplete, llmStream } = await import("../../llm/router.js")
const { llmCompleteStructured } = await import("../../llm/structured.js")
const { config } = await import("../../config.js")
const { z } = await import("zod")
const { handleMcpRequest } = await import("../../mcp/fastify-adapter.js")
const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js")
type ConcurrencyHold = import("../hold.js").ConcurrencyHold

/** The real fetch, for a real client (the provider egress's is stubbed in every test). */
const originalFetch: typeof fetch = globalThis.fetch

const coordinator: ConcurrencyHold = { role: "coordinator", lane: null, userId: "U", payer: "user:U", tier: "pro", jobId: "job-1", leaseId: null }
const billing = { provider: "kie", operation: "jobs.createTask", modelKey: "kling", body: {}, dimensions: {} }
const poll = { provider: "kie", operation: "jobs.recordInfo", modelKey: null, body: undefined, dimensions: {} }

let store: FakeLaneStore
let gate: ConcurrencyGate
let app: FastifyInstance
let fetchMock: ReturnType<typeof vi.fn>
const seen: Record<string, unknown> = {}

const otherMeta = (jobId: string, lane: "provider" | "llm" = "provider") => ({
  jobId, userId: "U", payer: "user:U" as const, lane, provider: "kie", source: null, sourceDetail: null,
  jobType: "image-to-video", model: null, queue: "video-generation" as const, bullJobId: jobId,
})

/** Fills the user's lane (its size in `refs.sizes`) with other jobs; returns the first one's lease. */
async function fillLane(lane: "provider" | "llm" = "provider"): Promise<string> {
  const leases: string[] = []
  for (let i = 0; i < refs.sizes[lane]; i++) {
    const r = await gate.acquire({ meta: otherMeta(`other-${lane}-${i}`, lane), size: refs.sizes[lane], mode: "fresh", leaseTtlMs: 3_600_000 })
    if (!r.granted) throw new Error("expected a grant")
    leases.push(r.leaseId)
  }
  return leases[0]!
}

const laneOf = async (lane: "provider" | "llm" = "provider") => (await gate.snapshot()).lines[0]?.lanes[lane]

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

async function until(check: () => Promise<boolean> | boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not met in time")
    await new Promise((r) => setTimeout(r, 5))
  }
}

let gateHandler: { promise: Promise<void>; resolve: (v: void) => void }
let handlerEntered: { promise: Promise<void>; resolve: (v: void) => void }

async function buildApp(): Promise<FastifyInstance> {
  const a = Fastify()
  installLaneRequestScope(a)
  // A stand-in for the auth hook: the user, and the internal lane for a header.
  a.addHook("preHandler", async (req: FastifyRequest) => {
    const user = req.headers["x-user"]
    if (typeof user === "string") req.userId = user
    if (req.headers["x-internal"] === "1") req.authKind = "internal"
  })
  a.post("/work", async () => {
    seen.before = currentConcurrencyHold()
    await providerFetch(billing, "https://provider.test/create")
    seen.after = currentConcurrencyHold()
    await providerFetch(billing, "https://provider.test/create")
    return { ok: true }
  })
  a.post("/poll", async () => {
    await providerFetch(poll, "https://provider.test/status")
    return { ok: true }
  })
  a.post("/parallel", async () => {
    await Promise.all([providerFetch(billing, "https://provider.test/a"), providerFetch(billing, "https://provider.test/b")])
    return { ok: true }
  })
  a.post("/guarded", { preHandler: laneGuard("llm") }, async () => {
    handlerEntered.resolve()
    await gateHandler.promise
    return { ok: true }
  })
  a.post("/stream-like", async (req: FastifyRequest) => {
    const lease = await acquireLiveLane(req, { lane: "llm", provider: "kie", onWaiting: () => undefined })
    seen.streamHold = currentConcurrencyHold()
    await lease.release("completed")
    return { ok: true }
  })
  // The real MCP door: the SDK's transport behind the route's own adapter, a
  // tool that reaches a route in-process as every MCP tool does.
  a.post("/mcp", async (req: FastifyRequest, reply: FastifyReply) => {
    const server = new McpServer({ name: "lanes-test", version: "1.0.0" })
    server.registerTool("work", { description: "reaches /work" }, async () => {
      const res = await a.inject({ method: "POST", url: "/work", headers: { "x-user": String(req.userId), "x-internal": "1" } })
      return { content: [{ type: "text" as const, text: JSON.stringify({ status: res.statusCode, retryAfter: res.headers["retry-after"] ?? null, body: res.json() }) }] }
    })
    await handleMcpRequest(server, req, reply)
  })
  a.post("/detached", async () => {
    setTimeout(() => { void providerFetch(billing, "https://provider.test/late").then(() => { seen.detachedDone = true }) }, 0)
    return { ok: true }
  })
  a.post("/replicate", async () => {
    const client = new Replicate({ auth: "test-token", fetch: egressSdkFetch("replicate", { createsWork: createsReplicatePrediction }) })
    await client.predictions.create({ version: "v1", input: {} })
    seen.replicateHold = currentConcurrencyHold()
    await client.predictions.get("p1")
    return { ok: true }
  })
  a.post("/llm", async () => {
    // However the call ends (no lane may be configured here), it took the request's llm slot first.
    await llmComplete({ modelId: "gemini-3.6-flash", system: "", messages: [{ role: "user", content: "hi" }], feature: "llm-chat" }).catch(() => undefined)
    seen.llmHold = currentConcurrencyHold()
    return { ok: true }
  })
  // A laneGuard slot, then a later preHandler that answers after the client left.
  a.post("/guard-then-refuse", {
    preHandler: [laneGuard("llm"), async (_req: FastifyRequest, reply: FastifyReply) => {
      handlerEntered.resolve()
      await gateHandler.promise
      return reply.code(402).send({ error: { code: "insufficient_credits" } })
    }],
  }, async () => ({ never: true }))
  // A non-async handler: a funnel call, then the answer later through `reply`.
  a.post("/sync-late", (_req: FastifyRequest, reply: FastifyReply) => {
    void providerFetch(billing, "https://provider.test/sync").then(() => handlerEntered.resolve())
    void gateHandler.promise.then(() => reply.send({ ok: true }))
  })
  // A handler whose first funnel call comes after its client left.
  a.post("/late-call", async (_req: FastifyRequest, reply: FastifyReply) => {
    await new Promise<void>((r) => reply.raw.once("close", () => r()))
    await providerFetch(billing, "https://provider.test/late-call")
    seen.lateCallDone = true
    return { ok: true }
  })
  // A guard that skips some requests, and guards whose body readers throw.
  a.post("/guard-when", { preHandler: laneGuard("llm", { when: (req) => req.headers["x-skip"] !== "1", provider: () => "kie" }) }, async () => ({ ok: true }))
  a.post("/guard-throws", {
    preHandler: laneGuard("llm", {
      when: () => { throw new Error("unreadable body") },
      provider: () => { throw new Error("unreadable body") },
    }),
  }, async () => ({ ok: true }))
  // A guarded route whose handler makes a funnel call: under a held lease neither takes a slot.
  a.post("/leased", { preHandler: laneGuard("llm", { provider: () => "kie", rule: "/leased" }) }, async () => {
    seen.leasedHold = currentConcurrencyHold()
    await providerFetch(billing, "https://provider.test/leased")
    return { ok: true }
  })
  a.post("/training", async () => {
    await runNotLimited("training", () => providerFetch(billing, "https://provider.test/train"))
    await runNotLimited("copilot", () => providerFetch({ ...billing, provider: "anthropic" }, "https://provider.test/turn"))
    return { ok: true }
  })
  await a.ready()
  return a
}

beforeEach(async () => {
  store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.sizes = { provider: 1, llm: 2, local: 2, run: 1 }
  refs.settings = { queueTimeoutMs: 3_600_000, liveWaitLimitMs: 600_000 }
  refs.onWake = null
  refs.available = true
  refs.hang = null
  for (const k of Object.keys(seen)) delete seen[k]
  gateHandler = deferred()
  handlerEntered = deferred()
  resetLaneCountersForTests()
  resetConcurrencySlotsForTests()
  resetHistoryHooksForTests()
  fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("/predictions")
    ? { id: "p1", status: "starting", urls: {} }
    : { ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
  vi.stubGlobal("fetch", fetchMock)
  await gate.setEnforced(true)
  app = await buildApp()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await app.close()
})

const post = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, headers: { "x-user": "U", ...headers } })

/**
 * An in-process request made under `hold`, as a job makes one. `inject`'s
 * answer is a lazy thenable that dispatches when it is awaited, so it is
 * awaited INSIDE the hold (as every in-process caller does), never handed out.
 */
const injectUnder = (hold: ConcurrencyHold, headers: Record<string, string> = {}) =>
  runHolding(hold, async () => await app.inject({ method: "POST", url: "/work", headers: { "x-user": "U", ...headers } }))

describe("the funnels inside a request", () => {
  it("a funnel call under a leaf hold acquires nothing", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const leaf: ConcurrencyHold = { ...coordinator, role: "leaf", lane: "provider", leaseId: "parent-lease" }
    const res = await injectUnder(leaf)
    expect(res.statusCode).toBe(200)
    expect(acquire).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("a funnel call inside a request with no hold takes a live slot held until the response", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    const res = await post("/work")
    expect(res.statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
    const call = acquire.mock.calls[0]![0]
    expect(call.mode).toBe("fresh")
    expect(call.meta).toMatchObject({ userId: "U", payer: "user:U", lane: "provider", provider: "kie", jobType: "jobs.createTask", model: "kling", queue: "live" })
    expect(call.meta.jobId.startsWith("live:")).toBe(true)
    expect(seen.before).toMatchObject({ role: "request", transport: "json" })
    expect(seen.after).toMatchObject({ role: "leaf", lane: "provider", transport: "json" })
    await until(() => release.mock.calls.length === 1)
    expect(release.mock.calls[0]![1]).toBe("completed")
    expect((await laneOf())?.running ?? 0).toBe(0)
  })

  it("a second funnel call in the same request reuses the slot", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/work")).statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(acquire).toHaveBeenCalledTimes(1)
    // Two calls at once share the one take.
    acquire.mockClear()
    expect((await post("/parallel")).statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it("an LLM router call inside a request takes the request's llm slot", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/llm")).statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0].meta).toMatchObject({ lane: "llm", jobType: "llm-chat", model: "gemini-3.6-flash", queue: "live" })
    expect(seen.llmHold).toMatchObject({ role: "leaf", lane: "llm" })
  })

  it("a poll egress (modelKey null) never acquires", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/poll")).statusCode).toBe(200)
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({})
  })

  it("a funnel call after the request settled takes no slot and is counted as ungated", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/detached")).statusCode).toBe(200)
    await until(() => seen.detachedDone === true)
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({ "jobs.createTask": 1 })
  })

  it("a request nobody is signed in to takes no slot", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await app.inject({ method: "POST", url: "/work" })).statusCode).toBe(200)
    expect(acquire).not.toHaveBeenCalled()
  })
})

describe("the live wait", () => {
  it("live wait expiry answers 503 lane_busy with Retry-After 60", async () => {
    refs.settings = { ...refs.settings, liveWaitLimitMs: 30 }
    await fillLane()
    const expiries: unknown[] = []
    registerLiveWaitExpiryRecorder((e) => expiries.push(e))
    const withdraw = vi.spyOn(gate, "withdraw")
    const res = await post("/work")
    expect(res.statusCode).toBe(503)
    expect(res.headers["retry-after"]).toBe("60")
    expect(res.json()).toEqual({ error: { code: "lane_busy", message: "Busy right now — try again in a few minutes." } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(withdraw).toHaveBeenCalledTimes(1)
    expect((await laneOf())?.queued).toBe(0)
    expect(expiries).toEqual([{ userId: "U", payer: "user:U", waitedMs: expect.any(Number) }])
  })

  it("the live wait is capped per transport", async () => {
    const s = { queueTimeoutMs: 7_200_000, liveWaitLimitMs: 600_000 }
    expect(liveWaitLimitMs(s, "json")).toBe(60_000)
    expect(liveWaitLimitMs(s, "sse")).toBe(600_000)
    expect(liveWaitLimitMs(s, "mcp")).toBe(45_000)
    expect(liveWaitLimitMs({ ...s, liveWaitLimitMs: 30_000 }, "sse")).toBe(30_000)

    // End to end: a JSON request gives up at its 60-s ceiling, not the 10-min setting.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
    await fillLane()
    let res: Awaited<ReturnType<typeof post>> | undefined
    const p = post("/work").then((r) => { res = r })
    await vi.advanceTimersByTimeAsync(59_000)
    expect(res).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_500)
    await p
    expect(res?.statusCode).toBe(503)
  })

  it("an SSE request waits past the JSON ceiling", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] })
    const other = await fillLane()
    let res: Awaited<ReturnType<typeof post>> | undefined
    const p = post("/work", { accept: "text/event-stream" }).then((r) => { res = r })
    await vi.advanceTimersByTimeAsync(90_000)
    expect(res).toBeUndefined()
    await refs.onWake!(await gate.release(other, "completed"))
    await vi.advanceTimersByTimeAsync(10)
    await p
    expect(res?.statusCode).toBe(200)
  })

  it("acquireLiveLane takes the request's slot and its release frees it early", async () => {
    const release = vi.spyOn(gate, "release")
    expect((await post("/stream-like")).statusCode).toBe(200)
    expect(seen.streamHold).toMatchObject({ role: "leaf", lane: "llm" })
    expect(release).toHaveBeenCalledTimes(1)
    expect((await laneOf("llm"))?.running ?? 0).toBe(0)
  })
})

describe("a real client", () => {
  let base: string
  beforeEach(async () => {
    await app.listen({ port: 0, host: "127.0.0.1" })
    const addr = app.server.address()
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`
  })
  // After each case's assertions, before the file's `app.close()`: drop the
  // sockets the real client left open. On Node 22 the close otherwise waited
  // about 4 s per case for the client's keep-alive socket to time out.
  afterEach(() => {
    app.server.closeAllConnections()
  })

  const realFetch = (path: string, signal: AbortSignal) =>
    originalFetch(`${base}${path}`, { method: "POST", headers: { "x-user": "U", "content-type": "application/json" }, body: "{}", signal })

  it("an MCP-injected route uses the mcp ceiling", async () => {
    // Over a real socket: the MCP transport's node adapter needs one.
    const acquire = vi.spyOn(gate, "acquire")
    const res = await originalFetch(`${base}/mcp`, {
      method: "POST",
      headers: { "x-user": "U", accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "work", arguments: {} } }),
    })
    expect(res.status).toBe(200)
    const text = ((await res.json()) as { result: { content: Array<{ text: string }> } }).result.content[0]!.text
    expect(JSON.parse(text)).toMatchObject({ status: 200 })
    // The /mcp request stays open while its tool runs (the transport answers
    // only once the tool's result is ready), so the tool's route waits as the
    // MCP request waits: on the mcp ceiling (45 s), not its own json one.
    expect(seen.before).toMatchObject({ role: "request", transport: "mcp" })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "fresh", meta: { queue: "live" } })
    expect(liveWaitLimitMs(refs.settings, "mcp")).toBe(45_000)
  })

  it("client abort while waiting ends the wait", async () => {
    await fillLane("llm")
    const withdraw = vi.spyOn(gate, "withdraw")
    const ac = new AbortController()
    const p = realFetch("/guarded", ac.signal).catch((e: unknown) => e)
    await until(async () => ((await laneOf("llm"))?.queued ?? 0) === 1)
    ac.abort()
    await p
    await until(() => withdraw.mock.calls.length === 1)
    expect((await laneOf("llm"))?.queued ?? 0).toBe(0)
    // The handler (and so any credit reservation in it) never ran.
    let entered = false
    void handlerEntered.promise.then(() => { entered = true })
    await new Promise((r) => setTimeout(r, 20))
    expect(entered).toBe(false)
  })

  it("a laneGuard slot whose handler never runs is released when its client leaves, once", async () => {
    const release = vi.spyOn(gate, "release")
    const renew = vi.spyOn(gate, "renew")
    const ac = new AbortController()
    const p = realFetch("/guard-then-refuse", ac.signal).catch((e: unknown) => e)
    await handlerEntered.promise // laneGuard granted; the later preHandler is still deciding
    expect((await laneOf("llm"))?.running).toBe(1)
    ac.abort()
    await p
    await until(() => release.mock.calls.length === 1)
    expect(release.mock.calls[0]![1]).toBe("failed")
    expect((await laneOf("llm"))?.running ?? 0).toBe(0)
    gateHandler.resolve() // the preHandler answers to nobody
    await new Promise((r) => setTimeout(r, 50))
    expect(release).toHaveBeenCalledTimes(1)
    expect(renew).not.toHaveBeenCalled()
  })

  it("a non-async handler's slot is released when its client leaves before it answers, once", async () => {
    const release = vi.spyOn(gate, "release")
    const ac = new AbortController()
    const p = realFetch("/sync-late", ac.signal).catch((e: unknown) => e)
    await handlerEntered.promise // its funnel call took the request's slot
    expect((await laneOf())?.running).toBe(1)
    ac.abort()
    await p
    await until(() => release.mock.calls.length === 1)
    expect((await laneOf())?.running ?? 0).toBe(0)
    gateHandler.resolve() // it answers to nobody
    await new Promise((r) => setTimeout(r, 50))
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("client already gone + lanes locked: the provider call still runs exactly as before", async () => {
    await gate.setEnforced(false)
    await fillLane()
    const acquire = vi.spyOn(gate, "acquire")
    const ac = new AbortController()
    const p = realFetch("/late-call", ac.signal).catch((e: unknown) => e)
    await until(async () => (await gate.snapshot()).lines.length > 0)
    await new Promise((r) => setTimeout(r, 20))
    ac.abort()
    await p
    await until(() => seen.lateCallDone === true)
    expect(fetchMock).toHaveBeenCalledWith("https://provider.test/late-call", expect.anything())
    expect(acquire).toHaveBeenCalledTimes(1) // measured (over its limit), never refused
    await until(async () => ((await laneOf())?.running ?? 0) === 1) // only the filler is left
  })

  it("client already gone with a free slot: the call is granted, not refused", async () => {
    const ac = new AbortController()
    const p = realFetch("/late-call", ac.signal).catch((e: unknown) => e)
    await new Promise((r) => setTimeout(r, 30))
    ac.abort()
    await p
    await until(() => seen.lateCallDone === true)
  })

  it("a laneGuard lease is released when the handler settles, not when the client aborts", async () => {
    const release = vi.spyOn(gate, "release")
    const ac = new AbortController()
    const p = realFetch("/guarded", ac.signal).catch((e: unknown) => e)
    await handlerEntered.promise
    expect((await laneOf("llm"))?.running).toBe(1)
    ac.abort()
    await p
    await new Promise((r) => setTimeout(r, 50))
    expect(release).not.toHaveBeenCalled()
    expect((await laneOf("llm"))?.running).toBe(1)
    gateHandler.resolve()
    await until(() => release.mock.calls.length === 1)
    expect((await laneOf("llm"))?.running ?? 0).toBe(0)
  })
})

describe("requests made in-process", () => {
  it("an injected route under a coordinator hold waits under the queue timeout", async () => {
    refs.settings = { queueTimeoutMs: 3_600_000, liveWaitLimitMs: 20 }
    const other = await fillLane()
    const acquire = vi.spyOn(gate, "acquire")
    let res: Awaited<ReturnType<typeof post>> | undefined
    const p = injectUnder(coordinator, { "x-internal": "1" }).then((r) => { res = r })
    // Far past the live-wait limit, it is still waiting, at the front of the job's line.
    await new Promise((r) => setTimeout(r, 200))
    expect(res).toBeUndefined()
    const call = acquire.mock.calls[0]![0]
    expect(call.mode).toBe("front")
    expect(call.meta.queue).toBe("inline")
    expect(call.meta.jobId.startsWith("job-1:call:")).toBe(true)
    await refs.onWake!(await gate.release(other, "completed"))
    await p
    expect(res?.statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it("a leaf-held inject passes through and a coordinator inject never hits the ensure refusal", async () => {
    await gate.setEnforced(false)
    const leaf: ConcurrencyHold = { ...coordinator, role: "leaf", lane: "provider", leaseId: "L" }
    const acquire = vi.spyOn(gate, "acquire")
    expect((await injectUnder(leaf)).statusCode).toBe(200)
    expect(acquire).not.toHaveBeenCalled()
    expect((await injectUnder(coordinator)).statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it("a client-sent lease or lane-parent header is not honoured", async () => {
    expect(LANE_PARENT_HEADER).toBe(PARENT_HEADER_AT_HOME)
    const acquire = vi.spyOn(gate, "acquire")
    const res = await post("/work", { [LANE_LEASE_HEADER]: "00000000-0000-4000-8000-000000000000", [LANE_PARENT_HEADER]: "director:00000000-0000-4000-8000-000000000000" })
    expect(res.statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0].mode).toBe("fresh")
  })
})

describe("SDK transports, not-limited work and work outside any scope", () => {
  it("a Replicate SDK prediction call takes a slot outside any hold", async () => {
    expect(createsReplicatePrediction("POST", "https://api.replicate.com/v1/predictions")).toBe(true)
    expect(createsReplicatePrediction("POST", "https://api.replicate.com/v1/models/o/n/predictions")).toBe(true)
    expect(createsReplicatePrediction("POST", "https://api.replicate.com/v1/deployments/o/n/predictions")).toBe(true)
    expect(createsReplicatePrediction("GET", "https://api.replicate.com/v1/predictions/p1")).toBe(false)
    expect(createsReplicatePrediction("POST", "https://api.replicate.com/v1/predictions/p1/cancel")).toBe(false)
    expect(createsFalRun("POST", "https://queue.fal.run/fal-ai/model")).toBe(true)
    expect(createsFalRun("GET", "https://queue.fal.run/fal-ai/model/requests/r1/status")).toBe(false)
    expect(createsFalRun("POST", "https://rest.alpha.fal.ai/storage/upload/initiate")).toBe(false)

    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/replicate")).statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0].meta).toMatchObject({ lane: "provider", provider: "replicate", jobType: "replicate/v1/predictions", queue: "live" })
    expect(seen.replicateHold).toMatchObject({ role: "leaf", lane: "provider" })
  })

  it("training and copilot are not limited and are counted", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/training")).statusCode).toBe(200)
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().notLimited).toEqual({ training: 1, copilot: 1 })
  })

  it("a structured LLM call outside any scope is counted once, not once per attempt", async () => {
    await llmCompleteStructured(
      { modelId: "gemini-3.6-flash", system: "", messages: [{ role: "user", content: "hi" }], feature: "llm-chat" },
      z.object({ a: z.string() }),
      { maxRetries: 2 },
    ).catch(() => undefined)
    expect(laneCounters().ungated).toEqual({ "llm-chat": 1 })
  })

  it("an LLM stream's own aborted signal still fails at its lane, as before, under any hold", async () => {
    const kieKey = config.KIE_API_KEY
    ;(config as { KIE_API_KEY: string }).KIE_API_KEY = "k".repeat(24)
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("This operation was aborted", "AbortError")
      return new Response("{}", { status: 200 })
    })
    try {
      const ac = new AbortController()
      ac.abort()
      const stream = () => llmStream({ modelId: "gemini-3.6-flash", system: "", messages: [{ role: "user", content: "hi" }], feature: "llm-chat" }, () => undefined, ac.signal)
      const outside = await stream().catch((e: unknown) => e)
      const underCoordinator = await runHolding(coordinator, async () => await stream().catch((e: unknown) => e))
      expect(outside).not.toBeInstanceOf(LaneWaitAbortedError)
      expect(underCoordinator).not.toBeInstanceOf(LaneWaitAbortedError)
      expect((underCoordinator as Error).name).toBe((outside as Error).name)
      expect((underCoordinator as Error).constructor).toBe((outside as Error).constructor)
    } finally {
      ;(config as { KIE_API_KEY: string }).KIE_API_KEY = kieKey
    }
  })

  it("a cron call outside any scope is counted as ungated", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    await providerFetch(billing, "https://provider.test/cron")
    await providerFetch(poll, "https://provider.test/cron-poll")
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({ "jobs.createTask": 1 })
  })
})

describe("an app without the request scope", () => {
  it("laneGuard on an app without installLaneRequestScope takes no slot", async () => {
    const bare = Fastify()
    bare.post("/g", { preHandler: laneGuard("llm") }, async (req: FastifyRequest) => {
      const lease = await acquireLiveLane(req, { lane: "llm", provider: null, onWaiting: () => undefined })
      await lease.release("completed")
      return { ok: true }
    })
    await bare.ready()
    const acquire = vi.spyOn(gate, "acquire")
    expect((await bare.inject({ method: "POST", url: "/g" })).statusCode).toBe(200)
    expect(acquire).not.toHaveBeenCalled()
    expect(laneCounters().ungated).toEqual({ "/g": 2 })
    await bare.close()
  })
})

describe("route lanes", () => {
  it("laneGuard registrations fill laneOfRoute, and a guard built from a rule names it", () => {
    expect(laneOfRoute("/guarded")).toBe("llm")
    expect(laneOfRoute("/work")).toBeNull()
    expect(laneRuleOfRoute("/leased")).toBe("/leased")
    expect(laneRuleOfRoute("/guarded")).toBeNull()
  })
})

describe("a held lease (a workflow's sync-HTTP hop)", () => {
  /** A slot the orchestrator holds for a node, as withConcurrencySlot takes one under a run hold. */
  async function holdLease(over: { userId?: string; payer?: `user:${string}` | `workspace:${string}`; lane?: "llm" | "provider" } = {}): Promise<string> {
    const userId = over.userId ?? "U"
    const r = await gate.acquire({
      meta: {
        jobId: `exec-1:call:${Math.random()}`, userId, payer: over.payer ?? `user:${userId}`, lane: over.lane ?? "llm", provider: "kie",
        source: null, sourceDetail: null, jobType: "llm-chat", model: null, queue: "inline", bullJobId: null,
      },
      size: 2, mode: "front", leaseTtlMs: 120_000,
    })
    if (!r.granted) throw new Error("expected a grant")
    return r.leaseId
  }
  const internal = (leaseId: string, user = "U") => ({ "x-user": user, "x-internal": "1", [LANE_LEASE_HEADER]: leaseId })

  it("the route honours a valid held lease and acquires nothing", async () => {
    const leaseId = await holdLease()
    const acquire = vi.spyOn(gate, "acquire")
    const renew = vi.spyOn(gate, "renew")
    const release = vi.spyOn(gate, "release")
    const res = await post("/leased", internal(leaseId))
    expect(res.statusCode).toBe(200)
    // Neither the guard nor the handler's funnel call took a slot: the node's one slot is the only one.
    expect(acquire).not.toHaveBeenCalled()
    expect(seen.leasedHold).toMatchObject({ role: "leaf", lane: "llm", leaseId, userId: "U", payer: "user:U", transport: "json" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The route never renews or releases a lease it did not take: its holder still has it.
    await new Promise((r) => setTimeout(r, 20))
    expect(renew).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    expect(await gate.leaseLine(leaseId)).toMatchObject({ userId: "U", lane: "llm" })
    expect((await laneOf("llm"))?.running).toBe(1)
  })

  it("a forged or other-user lease header is ignored", async () => {
    const mine = await holdLease()
    const others = await holdLease({ userId: "U2" })
    const workspace = await holdLease({ payer: "workspace:W" })
    const otherLane = await holdLease({ lane: "provider" })
    const released = await holdLease()
    await gate.release(released, "completed")
    const cases: Array<[string, Record<string, string>]> = [
      ["a client (not the internal lane) naming a live lease of its own user", { [LANE_LEASE_HEADER]: mine }],
      ["an internal request naming another user's lease", internal(others)],
      ["an internal request naming a lease of another payer line", internal(workspace)],
      ["an internal request naming a lease of another lane", internal(otherLane)],
      ["an internal request naming a released lease", internal(released)],
      ["an internal request naming no lease the gate knows", internal("00000000-0000-4000-8000-000000000000")],
    ]
    for (const [what, headers] of cases) {
      const acquire = vi.spyOn(gate, "acquire")
      const res = await post("/leased", headers)
      expect(res.statusCode, what).toBe(200)
      expect(acquire, what).toHaveBeenCalledTimes(1)
      expect(acquire.mock.calls[0]![0].mode, what).toBe("fresh")
      expect(seen.leasedHold, what).toMatchObject({ role: "leaf", lane: "llm" })
      expect((seen.leasedHold as ConcurrencyHold).leaseId, what).not.toBe(mine)
      acquire.mockRestore()
    }
  })

  it("a gate that cannot answer the lease check: the header is ignored and the request takes its own slot", async () => {
    const leaseId = await holdLease()
    vi.spyOn(gate, "leaseLine").mockRejectedValueOnce(new Error("redis down"))
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/leased", internal(leaseId))).statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it("a request without the header never asks the gate about a lease", async () => {
    const leaseLine = vi.spyOn(gate, "leaseLine")
    expect((await post("/leased", { "x-internal": "1" })).statusCode).toBe(200)
    expect(leaseLine).not.toHaveBeenCalled()
  })
})

describe("a guard's when and provider", () => {
  it("a request its when refuses takes no slot, and the route keeps its lane", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/guard-when", { "x-skip": "1" })).statusCode).toBe(200)
    expect(acquire).not.toHaveBeenCalled()
    expect((await post("/guard-when")).statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0].meta).toMatchObject({ lane: "llm", provider: "kie", jobType: "/guard-when" })
    expect(laneOfRoute("/guard-when")).toBe("llm")
  })

  it("a when or provider that throws never fails the request: it takes the slot, with no provider", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/guard-throws")).statusCode).toBe(200)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0].meta).toMatchObject({ lane: "llm", provider: null })
  })
})

describe("enforcement off", () => {
  it("with enforcement off changes nothing", async () => {
    await gate.setEnforced(false)
    refs.settings = { queueTimeoutMs: 1, liveWaitLimitMs: 1 }
    await fillLane()
    await fillLane("llm")
    const release = vi.spyOn(gate, "release")
    // A live request, a guarded one, and a coordinator's in-process one: none waits, none is refused.
    expect((await post("/work")).statusCode).toBe(200)
    gateHandler.resolve()
    expect((await post("/guarded")).statusCode).toBe(200)
    expect((await injectUnder(coordinator, { "x-internal": "1" })).statusCode).toBe(200)
    expect(refs.onWake).toBeNull() // nothing ever waited
    await until(() => release.mock.calls.length === 3)
    // Measured: every request's slot is released, so only the two fillers still run.
    expect(await laneOf()).toMatchObject({ running: 1, queued: 0 })
    expect(await laneOf("llm")).toMatchObject({ running: 2, queued: 0 })
  })
})

describe("limits locked (this release): nothing lane-related delays a request", () => {
  let hung: { promise: Promise<void>; resolve: (v: void) => void }
  const settle = () => new Promise((r) => setTimeout(r, 20))
  beforeEach(() => {
    refs.available = false
    hung = deferred()
    refs.hang = hung.promise
  })

  it("a guarded live request reaches its handler at once while the gate hangs; its slot is counted and freed once, when the take lands", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    gateHandler.resolve()
    expect((await post("/guarded")).statusCode).toBe(200)
    // The request answered before the gate was even asked.
    expect(acquire).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
    hung.resolve()
    await until(() => release.mock.calls.length === 1)
    expect(acquire).toHaveBeenCalledTimes(1)
    const asked = acquire.mock.calls[0]![0]
    expect(asked).toMatchObject({ mode: "fresh", meta: { lane: "llm", queue: "live" } })
    expect(release).toHaveBeenCalledWith(asked.leaseId, "completed")
    await settle()
    expect(release).toHaveBeenCalledTimes(1)
    expect((await laneOf("llm"))?.running ?? 0).toBe(0)
  })

  it("funnel calls inside a request run at once and share one take", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    expect((await post("/work")).statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(seen.after).toMatchObject({ role: "leaf", lane: "provider", leaseId: expect.any(String) })
    hung.resolve()
    await until(() => release.mock.calls.length === 1)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith((seen.after as ConcurrencyHold).leaseId, "completed")
  })

  it("acquireLiveLane answers at once, and its early release frees the slot once, when the take lands", async () => {
    const release = vi.spyOn(gate, "release")
    expect((await post("/stream-like")).statusCode).toBe(200)
    expect(seen.streamHold).toMatchObject({ role: "leaf", lane: "llm" })
    hung.resolve()
    await until(() => release.mock.calls.length === 1)
    await settle()
    expect(release).toHaveBeenCalledTimes(1)
    expect((await laneOf("llm"))?.running ?? 0).toBe(0)
  })

  it("an in-process request under a coordinator runs at once", async () => {
    const res = await injectUnder(coordinator, { "x-internal": "1" })
    expect(res.statusCode).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("a take that fails releases nothing, and the request is answered as usual", async () => {
    refs.hang = null
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(gate, "acquire").mockRejectedValue(new Error("redis down"))
    const release = vi.spyOn(gate, "release")
    gateHandler.resolve()
    expect((await post("/guarded")).statusCode).toBe(200)
    await until(() => (laneCounters().ungated["/guarded"] ?? 0) === 1)
    await settle()
    expect(release).not.toHaveBeenCalled()
  })

  it("a full lane on an enforced gate (never enforced while locked) is never a 503: the request runs and is counted ungated", async () => {
    refs.hang = null
    refs.settings = { queueTimeoutMs: 1, liveWaitLimitMs: 1 }
    await fillLane("llm")
    gateHandler.resolve()
    const res = await post("/guarded")
    expect(res.statusCode).toBe(200)
    await until(() => (laneCounters().ungated["/guarded"] ?? 0) === 1)
    expect(refs.onWake).toBeNull() // nothing ever waited
  })

  it("an internal request naming its caller's lease adopts it without asking the gate, and takes no slot", async () => {
    const leaseLine = vi.spyOn(gate, "leaseLine")
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    const leaseId = "lease-the-orchestrator-asked-for"
    const res = await post("/leased", { "x-internal": "1", [LANE_LEASE_HEADER]: leaseId })
    expect(res.statusCode).toBe(200)
    expect(seen.leasedHold).toMatchObject({ role: "leaf", lane: "llm", leaseId })
    hung.resolve()
    await settle()
    expect(leaseLine).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled() // the caller's to release, never the route's
  })

  it("a client cannot name a lease: without internal auth the header is ignored and the request takes its own slot", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/leased", { [LANE_LEASE_HEADER]: "forged" })).statusCode).toBe(200)
    expect((seen.leasedHold as ConcurrencyHold).leaseId).not.toBe("forged")
    hung.resolve()
    await until(() => acquire.mock.calls.length === 1)
  })
})
