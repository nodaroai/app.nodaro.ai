/**
 * Admin → Live usage: GET /v1/admin/lanes/live, /users/:id and /history, and
 * the operator's cancel of a queued job, on an in-memory database, a real gate
 * over the JS twin of its scripts, and an in-memory Redis for the keys each
 * process publishes (written through the real publisher).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { ConcurrencyGate } from "../../../lib/concurrency-lanes/gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { makeFakeLaneDb, type FakeLaneDb } from "../../../lib/concurrency-lanes/__tests__/fake-lane-db.js"
import type { LaneEntryMeta } from "../../../lib/concurrency-lanes/types.js"
import type { OccupancyClient } from "../../../lib/concurrency-lanes/server-occupancy.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const PAYER = "00000000-0000-4000-8000-0000000000bb"
const USER = "00000000-0000-4000-8000-0000000000aa"
const OTHER = "00000000-0000-4000-8000-0000000000cc"
const JOB = "00000000-0000-4000-8000-00000000f001"
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0)

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  db: null as unknown as { client: { from(t: string): unknown } },
  credits: true,
  payer: null as string | null,
  refund: [] as string[],
  balance: [] as string[],
}))

vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => refs.credits,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (t: string) => refs.db.client.from(t) } }))
vi.mock("@/lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deployment-payer.js")>()),
  deploymentPayerId: () => refs.payer,
}))
const ADMINS = new Set(["00000000-0000-4000-8000-0000000000ad", "00000000-0000-4000-8000-0000000000bb"])
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
    if (!ADMINS.has(req.userId ?? "")) return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))
vi.mock("@/ee/middleware/require-platform-operator.js", () => ({
  requirePlatformOperator: async (req: { userId?: string }, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
    if (req.userId !== "00000000-0000-4000-8000-0000000000ad") return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
  },
}))
// The queue removal leaves BullMQ out; it withdraws from the lane as the real one does first.
vi.mock("@/lib/queue.js", () => ({
  tryRemoveFromQueue: async (jobId: string) => (await import("@/lib/concurrency-lanes/withdraw.js")).withdrawFromLane(jobId),
  oneScanAtATime: () => (scan: () => Promise<void>) => scan(),
  redis: {},
}))
// The refund and the balance cache, as the owner's cancel route test observes them.
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { refundCredits: async (id: string) => { refs.refund.push(id) } } }))
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: (id: string) => { refs.balance.push(id) } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: (id: string) => { refs.balance.push(id) } }))
vi.mock("@/lib/job-policy-gate.js", () => ({ withdrawHeldJob: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock("@/lib/use-case/cancel-run.js", () => ({ cancelUseCaseInnerExecution: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/llm-billing.js", () => ({ settleSweptMeteredLlmJob: vi.fn().mockResolvedValue("not-metered") }))
vi.mock("@/ee/billing/llm-cancel-settle.js", () => ({
  settleBilledLedgerBeforeCancelImpl: vi.fn().mockResolvedValue("not-metered"),
  ledgerBilled: () => false,
  ledgerInFlight: () => false,
}))

const { config } = await import("@/lib/config.js")
const { adminLanesRoutes } = await import("../admin-lanes.js")
const { invalidateLaneConfigCache, resetLaneTierCacheForTests } = await import("../../concurrency-lanes/plan-sizes.js")
const { serverShare, resetServerShareForTests } = await import("@/lib/concurrency-lanes/server-share.js")
const { publishLaneCounters, publishServerOccupancy, serverProcessId } = await import("@/lib/concurrency-lanes/server-occupancy.js")
const { countUngated, resetLaneCountersForTests } = await import("@/lib/concurrency-lanes/hold.js")
const { PROFILE_CHUNK } = await import("../../concurrency-lanes/live-usage.js")
const { resetLaneColumnsForTests } = await import("@/lib/concurrency-lanes/columns.js")

/** An in-memory Redis for the published keys: SET with PX, the index's sorted-set commands, SCAN with MATCH, MGET. */
function makeScanRedis() {
  const kv = new Map<string, string>()
  const zsets = new Map<string, Map<string, number>>()
  const glob = (p: string) => new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`)
  const score = (v: number | string, inf: number) => (v === "+inf" ? Infinity : v === "-inf" ? -Infinity : typeof v === "number" ? v : Number(v) || inf)
  const r = {
    kv,
    zsets,
    scans: 0,
    status: "ready",
    async set(k: string, v: string) { kv.set(k, v); return "OK" as const },
    async zadd(k: string, ...args: Array<number | string>) {
      const z = zsets.get(k) ?? zsets.set(k, new Map()).get(k)!
      for (let i = 0; i < args.length; i += 2) z.set(String(args[i + 1]), Number(args[i]))
      return args.length / 2
    },
    async zremrangebyscore(k: string, min: number | string, max: number | string) {
      const z = zsets.get(k)
      if (!z) return 0
      let n = 0
      for (const [m, sc] of z) if (sc >= score(min, -Infinity) && sc <= score(max, Infinity)) { z.delete(m); n++ }
      return n
    },
    async pexpire() { return 1 },
    async zrangebyscore(k: string, min: number | string, max: number | string) {
      return [...(zsets.get(k) ?? new Map<string, number>())].filter(([, sc]) => sc >= score(min, -Infinity) && sc <= score(max, Infinity)).map(([m]) => m)
    },
    async scan(_cursor: string, _m: "MATCH", pattern: string, _c: "COUNT", _n: number): Promise<[string, string[]]> {
      r.scans += 1
      const re = glob(pattern)
      return ["0", [...kv.keys()].filter((k) => re.test(k))]
    },
    async mget(...keys: string[]) { return keys.map((k) => kv.get(k) ?? null) },
  }
  return r
}

let app: FastifyInstance
let db: FakeLaneDb
let gate: ConcurrencyGate
let clock: number
let scanRedis: ReturnType<typeof makeScanRedis>

async function build(): Promise<void> {
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    req.authKind = (req.headers["x-auth-kind"] as typeof req.authKind) ?? "jwt"
  })
  await app.register(adminLanesRoutes, { live: { redis: async () => scanRedis, now: () => clock } })
  await app.ready()
}

const call = (method: "GET" | "POST", url: string, user = ADMIN, authKind = "jwt") =>
  app.inject({ method, url, headers: { "x-user-id": user, "x-auth-kind": authKind } })

const meta = (jobId: string, over: Partial<LaneEntryMeta> = {}): LaneEntryMeta => ({
  jobId, userId: USER, payer: `user:${USER}`, lane: "provider", provider: "kie", source: "web", sourceDetail: null,
  jobType: "generate-image", model: "flux-2", queue: "video-generation", bullJobId: `bull-${jobId}`, ...over,
})
const acquire = (jobId: string, size: number, over: Partial<LaneEntryMeta> = {}) =>
  gate.acquire({ meta: meta(jobId, over), size, mode: "fresh", leaseTtlMs: 3_600_000 })

beforeEach(async () => {
  db = makeFakeLaneDb()
  refs.db = db
  refs.credits = true
  refs.payer = null
  refs.refund = []
  refs.balance = []
  clock = T0
  db.rows("profiles").push(
    { id: ADMIN, email: "admin@example.com", full_name: "Admin" },
    { id: USER, email: "dana@example.com", full_name: "Dana", tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0 },
    { id: OTHER, email: "omer@example.com", full_name: "Omer", tier: "free", subscription_tier: null, lifetime_topup_credits: 0 },
    { id: PAYER, email: "payer@example.com", full_name: "Payer", tier: "business", subscription_tier: "business", lifetime_topup_credits: 0 },
  )
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store), now: () => clock })
  refs.gate = gate
  scanRedis = makeScanRedis()
  vi.stubEnv("RUNTIME_ENV", "production")
  config.LANES_ENFORCED = false
  invalidateLaneConfigCache()
  resetLaneTierCacheForTests()
  resetServerShareForTests()
  resetLaneCountersForTests()
  await build()
})

afterEach(async () => {
  await app.close()
  vi.unstubAllEnvs()
})

describe("GET /v1/admin/lanes/live", () => {
  it("answers an admin signed in to the app; 403 for a non-admin and for an admin's API or app token", async () => {
    expect((await call("GET", "/v1/admin/lanes/live")).statusCode).toBe(200)
    expect((await call("GET", "/v1/admin/lanes/live", USER)).statusCode).toBe(403)
    for (const kind of ["api_token", "app_token"]) {
      const res = await call("GET", "/v1/admin/lanes/live", ADMIN, kind)
      expect(res.statusCode, kind).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
    }
  })

  it("live shows would-wait counts with enforcement off", async () => {
    await gate.setEnforced(false)
    for (const id of ["a", "b", "c"]) await acquire(id, 2, { source: id === "c" ? "mcp" : "web" })
    const body = (await call("GET", "/v1/admin/lanes/live")).json()
    expect(body).toMatchObject({ env: "production", enforced: false, available: false })
    expect(body.totals).toEqual({ activeUsers: 1, running: 3, queued: 0, overLimit: 1, longestWaitMs: 0 })
    expect(body.lines).toHaveLength(1)
    expect(body.lines[0]).toMatchObject({
      userId: USER, email: "dana@example.com", name: "Dana", payer: `user:${USER}`, tier: "pro", override: null,
      sources: { web: 2, mcp: 1 },
    })
    expect(body.lines[0].lanes.provider).toEqual({ running: 3, overLimit: 1, queued: 0, limit: 2 })
    expect(body.lines[0].lanes.llm).toEqual({ running: 0, overLimit: 0, queued: 0, limit: null })
    expect(body.providers).toEqual([{
      provider: "kie", running: 3, ceiling: null, topUsers: [{ userId: USER, email: "dana@example.com", running: 3 }],
      completed15m: 0, failed15m: 0, failureRate15m: null,
    }])
  })

  it("names a line's MCP clients, cleaned, most first, at most five; no other source's detail", async () => {
    await gate.setEnforced(false)
    const mcp = (sourceDetail: string) => ({ source: "mcp", sourceDetail })
    let n = 0
    const run = async (times: number, over: Partial<LaneEntryMeta>) => {
      for (let i = 0; i < times; i++) await acquire(`j${n++}`, 50, over)
    }
    await run(3, mcp("client-a"))
    await run(2, mcp("client-b"))
    await run(1, mcp("client\u200B-b")) // a zero-width character: cleaned, the same name
    await run(2, mcp("\u202Eevil\u0007  name"))
    await run(2, mcp("a".repeat(80)))
    await run(1, mcp("client-f"))
    await run(1, mcp("client-e"))
    await run(1, mcp("\u200B\u200B")) // nothing readable: unnamed
    await run(1, { source: "app", sourceDetail: "app-id-1" })
    const line = (await call("GET", "/v1/admin/lanes/live")).json().lines[0]
    expect(line.sources).toEqual({ mcp: 13, app: 1 })
    // Ties in name order; client-f is the sixth name and is not listed (the page counts it among "others").
    expect(line.mcpClients).toEqual([
      { name: "client-a", count: 3 },
      { name: "client-b", count: 3 },
      { name: `${"a".repeat(39)}…`, count: 2 },
      { name: "evil name", count: 2 },
      { name: "client-e", count: 1 },
    ])
    expect(JSON.stringify(line)).not.toContain("app-id-1")
  })

  it("lists waiting jobs and the longest wait once limits are on, the longest line first", async () => {
    await gate.setEnforced(true)
    await acquire("a", 1)
    await acquire("o", 1, { userId: OTHER, payer: `user:${OTHER}` })
    clock += 1_000
    await acquire("b", 1)
    await acquire("c", 1)
    clock += 4_000
    const body = (await call("GET", "/v1/admin/lanes/live")).json()
    expect(body.enforced).toBe(true)
    expect(body.lines.map((l: { userId: string }) => l.userId)).toEqual([USER, OTHER])
    expect(body.lines[0].lanes.provider).toEqual({ running: 1, overLimit: 0, queued: 2, limit: 1 })
    expect(body.totals).toEqual({ activeUsers: 2, running: 2, queued: 2, overLimit: 0, longestWaitMs: 4_000 })
  })

  it("live reports the video pool's occupancy from the worker process", async () => {
    const video = serverShare("video", 8)
    expect(video.tryEnter({ userId: USER, jobId: "j1", coordinator: false, exempt: false }).entered).toBe(true)
    expect(video.tryEnter({ userId: USER, jobId: "j2", coordinator: true, exempt: false }).entered).toBe(true)
    expect(video.tryEnter({ userId: USER, jobId: "j3", coordinator: false, exempt: true }).entered).toBe(true)
    await publishServerOccupancy({ client: scanRedis as unknown as OccupancyClient })
    // Another environment's process (staging shares nothing here) is not this page's.
    scanRedis.kv.set("cl:v1:servers:staging:video:elsewhere-1", JSON.stringify({ pool: "video", processId: "elsewhere-1", held: 5 }))
    await scanRedis.zadd("cl:v1:published:staging", Date.now() + 15_000, "cl:v1:servers:staging:video:elsewhere-1")
    const body = (await call("GET", "/v1/admin/lanes/live")).json()
    expect(body.servers.video).toEqual([{
      processId: serverProcessId(), at: expect.any(Number), poolSize: 8, held: 3, userCap: 2, coordinators: 1, coordinatorCap: 4, overCapUsers: 1,
    }])
    expect(body.servers.render).toEqual([])
    expect(body.serversComplete).toBe(true)
    // Found through the publishers' index, not by walking the keyspace.
    expect(scanRedis.scans).toBe(0)
  })

  it("finds the published keys by SCAN when there is no index yet", async () => {
    scanRedis.kv.set(`cl:v1:servers:production:render:old-1`, JSON.stringify({ pool: "render", processId: "old-1", held: 2, poolSize: 4, userCap: 1, byUser: { a: 2 } }))
    const body = (await call("GET", "/v1/admin/lanes/live")).json()
    expect(body.servers.render).toMatchObject([{ processId: "old-1", held: 2, overCapUsers: 1 }])
    expect(scanRedis.scans).toBe(1)
  })

  it("sums every process's counters and says since when they count", async () => {
    countUngated("generate-image")
    countUngated("generate-image")
    await publishLaneCounters({ client: scanRedis as unknown as OccupancyClient })
    scanRedis.kv.set("cl:v1:counters:production:other-7", JSON.stringify({ startedAt: T0 - 60_000, ungated: { "generate-image": 3 }, notLimited: { training: 1 }, failOpen: {} }))
    await scanRedis.zadd("cl:v1:published:production", Date.now() + 15_000, "cl:v1:counters:production:other-7")
    const body = (await call("GET", "/v1/admin/lanes/live")).json()
    expect(body.ungated).toEqual({ "generate-image": 5 })
    expect(body.notLimited).toEqual({ training: 1 })
    expect(body.counters.processes).toBe(2)
    expect(body.counters.oldestStartedAt).toBe(new Date(T0 - 60_000).toISOString())
    expect(body.undeclaredPluginTypes).toEqual([])
  })

  it("reads profiles in batches of at most 200 ids, and once while the answer is fresh", async () => {
    await gate.setEnforced(false)
    for (let i = 0; i < 450; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
      await acquire(`job-${i}`, 5, { userId: id, payer: `user:${id}` })
    }
    const res = await call("GET", "/v1/admin/lanes/live")
    expect(res.statusCode).toBe(200)
    expect(res.json().lines).toHaveLength(450)
    expect(db.inLengths.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...db.inLengths)).toBeLessThanOrEqual(PROFILE_CHUNK)
    const selects = db.selects.filter((s) => s.startsWith("profiles:")).length
    await call("GET", "/v1/admin/lanes/live")
    expect(db.selects.filter((s) => s.startsWith("profiles:")).length).toBe(selects)
  })

  it("shows ids when names cannot be read, and reads them again on the next call", async () => {
    await acquire("a", 2)
    db.failing.add("profiles")
    const res = await call("GET", "/v1/admin/lanes/live")
    expect(res.statusCode).toBe(200)
    expect(res.json().lines[0]).toMatchObject({ userId: USER, email: null, name: null })
    db.failing.delete("profiles")
    expect((await call("GET", "/v1/admin/lanes/live")).json().lines[0]).toMatchObject({ email: "dana@example.com" })
  })

  it("shows an account's override on Cloud", async () => {
    db.rows("lane_user_overrides").push({ user_id: USER, provider: 7, llm: null, local: null, run: null })
    await acquire("a", 7)
    expect((await call("GET", "/v1/admin/lanes/live")).json().lines[0]).toMatchObject({ tier: "pro", override: { provider: 7 } })
  })

  it("is in every edition with an admin; off Cloud there are no plans, so no tier or override", async () => {
    await app.close()
    refs.credits = false
    await build()
    await acquire("a", 12)
    const res = await call("GET", "/v1/admin/lanes/live")
    expect(res.statusCode).toBe(200)
    expect(res.json().lines[0]).toMatchObject({ userId: USER, tier: null, override: null })
  })
})

describe("the deployment's payer is listed to itself only", () => {
  beforeEach(async () => {
    refs.payer = PAYER
    await gate.setEnforced(false)
    await acquire("p", 4, { userId: PAYER, payer: `deployment:${PAYER}` })
    await acquire("m", 4, { payer: `deployment:${PAYER}` })
    db.rows("lane_user_overrides").push({ user_id: PAYER, provider: 9, llm: null, local: null, run: null })
    db.rows("lane_usage_daily").push(
      { day: "2026-10-30", runtime_env: "production", user_id: PAYER, payer: `deployment:${PAYER}`, minutes_at_limit: 9 },
      { day: "2026-10-30", runtime_env: "production", user_id: USER, payer: `deployment:${PAYER}`, minutes_at_limit: 1 },
    )
  })

  it("on /live: neither its lines, nor among a provider's top users, nor its id in another member's line", async () => {
    const body = (await call("GET", "/v1/admin/lanes/live")).json()
    expect(body.lines.map((l: { userId: string }) => l.userId)).toEqual([USER])
    expect(body.lines[0].payer).toBe("deployment")
    // The payer's plan and override are that account's: not shown either.
    expect(body.lines[0]).toMatchObject({ tier: null, override: null })
    expect(body.totals.running).toBe(1)
    expect(body.providers[0].topUsers.map((u: { userId: string }) => u.userId)).toEqual([USER])
    expect(JSON.stringify(body)).not.toContain(PAYER)
  })

  it("to the payer itself, everything", async () => {
    clock += 3_000 // past the cached report
    const body = (await call("GET", "/v1/admin/lanes/live", PAYER)).json()
    expect(body.lines.map((l: { userId: string }) => l.userId).sort()).toEqual([PAYER, USER].sort())
    expect(body.lines.every((l: { payer: string }) => l.payer === `deployment:${PAYER}`)).toBe(true)
  })

  it("on /users/:id: the payer is no such user, and a member's line does not name it", async () => {
    expect((await call("GET", `/v1/admin/lanes/users/${PAYER}`)).statusCode).toBe(404)
    expect((await call("GET", `/v1/admin/lanes/users/${PAYER}`, PAYER)).statusCode).toBe(200)
    const member = (await call("GET", `/v1/admin/lanes/users/${USER}`)).json()
    expect(member.lines.map((l: { payer: string }) => l.payer)).toEqual(["deployment"])
    expect(member.lines[0]).toMatchObject({ tier: null, override: null })
    expect(JSON.stringify(member)).not.toContain(PAYER)
  })

  it("on /history: not its rows, and not its id", async () => {
    const body = (await call("GET", "/v1/admin/lanes/history?view=users")).json()
    expect(body.users.map((u: { userId: string }) => u.userId)).toEqual([USER])
    expect(JSON.stringify(body)).not.toContain(PAYER)
  })
})

describe("GET /v1/admin/lanes/users/:id", () => {
  it("lists the user's running and queued entries per payer line, with the last 30 days", async () => {
    await gate.setEnforced(true)
    await acquire("a", 1, { source: "mcp", sourceDetail: "client-a desktop", jobType: "generate-video", model: "kling-3" })
    clock += 2_000
    await acquire("b", 1)
    await acquire("w", 2, { payer: "workspace:W", lane: "llm", provider: null, jobType: "llm-chat", model: null })
    clock += 1_000
    db.rows("lane_usage_daily").push(
      { day: "2026-10-30", runtime_env: "production", user_id: USER, payer: `user:${USER}`, peak_running: { provider: 2 }, minutes_at_limit: 4, longest_wait_ms: 9_000 },
      { day: "2026-10-29", runtime_env: "staging", user_id: USER, payer: `user:${USER}`, minutes_at_limit: 50 },
      { day: "2026-09-01", runtime_env: "production", user_id: USER, payer: `user:${USER}`, minutes_at_limit: 70 },
    )
    const res = await call("GET", `/v1/admin/lanes/users/${USER}`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ userId: USER, email: "dana@example.com", name: "Dana", env: "production" })
    expect(body.lines).toHaveLength(2)
    expect(body.lines[0]).toMatchObject({ payer: `user:${USER}`, tier: "pro", override: null })
    expect(body.lines[0].entries).toEqual([
      { jobId: "a", payer: `user:${USER}`, lane: "provider", state: "running", provider: "kie", source: "mcp", sourceDetail: "client-a desktop",
        jobType: "generate-video", model: "kling-3", overLimit: false, runningMs: 3_000, waitedMs: null, position: null, reason: null },
      { jobId: "b", payer: `user:${USER}`, lane: "provider", state: "queued", provider: "kie", source: "web", sourceDetail: null,
        jobType: "generate-image", model: "flux-2", overLimit: false, runningMs: null, waitedMs: 1_000, position: 1, reason: "user_lane" },
    ])
    expect(body.lines[1]).toMatchObject({ payer: "workspace:W", tier: "business", override: null })
    expect(body.lines[1].entries.map((e: { jobId: string }) => e.jobId)).toEqual(["w"])
    // Only this environment's days, and only the last 30.
    expect(body.history.available).toBe(true)
    expect(body.history.rows).toHaveLength(1)
    expect(body.history.rows[0]).toMatchObject({ day: "2026-10-30", minutesAtLimit: 4, longestWaitMs: 9_000, peakRunning: { provider: 2, llm: 0, local: 0, run: 0 } })
  })

  it("an id with no account and nothing in the lanes is no such user", async () => {
    expect((await call("GET", "/v1/admin/lanes/users/00000000-0000-4000-8000-00000000dead")).statusCode).toBe(404)
  })

  it("still answers the history when the lanes cannot be read", async () => {
    db.rows("lane_usage_daily").push({ day: "2026-10-30", runtime_env: "production", user_id: USER, payer: `user:${USER}`, minutes_at_limit: 4 })
    refs.gate = { userEntries: async () => { throw new Error("Redis is down") } }
    const res = await call("GET", `/v1/admin/lanes/users/${USER}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ userId: USER, email: "dana@example.com", lines: [], linesAvailable: false })
    expect(res.json().history.rows).toHaveLength(1)
  })

  it("answers an admin in the app only, and rejects an id that is not one", async () => {
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`, ADMIN, "api_token")).statusCode).toBe(403)
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`, USER)).statusCode).toBe(403)
    expect((await call("GET", "/v1/admin/lanes/users/not-a-uuid")).statusCode).toBe(400)
  })

  it("returns the user's own override and its note from the table, with nothing in the lanes", async () => {
    db.rows("lane_user_overrides").push({ user_id: USER, provider: 7, llm: null, local: 30, run: null, note: "studio account", updated_at: "2026-10-29T10:00:00.000Z" })
    const body = (await call("GET", `/v1/admin/lanes/users/${USER}`)).json()
    expect(body.lines).toEqual([])
    expect(body.own).toEqual({ available: true, override: { provider: 7, local: 30 }, note: "studio account", updatedAt: "2026-10-29T10:00:00.000Z" })
  })

  it("own says no override, says the table is absent, and is null off Cloud", async () => {
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`)).json().own).toEqual({ available: true, override: null, note: null, updatedAt: null })
    db.missingTables.add("lane_user_overrides")
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`)).json().own).toMatchObject({ available: false, override: null })
    db.missingTables.delete("lane_user_overrides")
    await app.close()
    refs.credits = false
    await build()
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`)).json().own).toBeNull()
  })

  it("a save shows at once: the override is read now, not from the sizes' cache", async () => {
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`)).json().own.override).toBeNull()
    db.rows("lane_user_overrides").push({ user_id: USER, provider: 5, llm: null, local: null, run: null, note: null })
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`)).json().own.override).toEqual({ provider: 5 })
  })

  it("reads the user's 30 days once a minute however often the drawer asks", async () => {
    db.rows("lane_usage_daily").push({ day: "2026-10-30", runtime_env: "production", user_id: USER, payer: `user:${USER}`, minutes_at_limit: 4 })
    const historyReads = () => db.selects.filter((s) => s.startsWith("lane_usage_daily:")).length
    await call("GET", `/v1/admin/lanes/users/${USER}`)
    const first = historyReads()
    expect(first).toBeGreaterThan(0)
    clock += 3_000
    db.rows("lane_usage_daily").push({ day: "2026-10-29", runtime_env: "production", user_id: USER, payer: `user:${USER}`, minutes_at_limit: 2 })
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`)).json().history.rows).toHaveLength(1)
    expect(historyReads()).toBe(first)
    clock += 60_000
    expect((await call("GET", `/v1/admin/lanes/users/${USER}`)).json().history.rows).toHaveLength(2)
    expect(historyReads()).toBeGreaterThan(first)
  })

  it("still answers the live entries while the history tables are not in this database", async () => {
    db.missingTables.add("lane_usage_daily")
    await acquire("a", 1)
    const body = (await call("GET", `/v1/admin/lanes/users/${USER}`)).json()
    expect(body.lines[0].entries).toHaveLength(1)
    expect(body.history).toEqual({ days: 30, available: false, rows: [] })
  })
})

describe("POST /v1/admin/lanes/jobs/:jobId/cancel", () => {
  beforeEach(async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "")
    db.rows("jobs").push({
      id: JOB, user_id: USER, status: "queued", input_data: {}, provider: null, provider_task_id: null, reconcile_attempts: 0,
      lane_env: "production", lane_env_id: null,
    })
    db.rows("usage_logs").push({ id: "usage-1", job_id: JOB, status: "reserved", action: "generate-image" })
    await gate.setEnforced(true)
    await acquire("running", 1)
    await acquire(JOB, 1)
  })

  it("the admin cancel refunds: out of its line, cancelled, its hold refunded, the owner's balance refreshed", async () => {
    expect(await gate.describeWait(JOB)).toMatchObject({ position: 1 })
    const res = await call("POST", `/v1/admin/lanes/jobs/${JOB}/cancel`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ cancelled: true, inFlight: false, userId: USER })
    expect(await gate.describeWait(JOB)).toBeNull()
    expect(db.rows("jobs")[0]!.status).toBe("cancelled")
    expect(refs.refund).toEqual(["usage-1"])
    expect(refs.balance).toEqual([USER])
  })

  it("never cancels a job another environment parked (shared database, separate Redis)", async () => {
    db.rows("jobs")[0]!.lane_env = "staging"
    const res = await call("POST", `/v1/admin/lanes/jobs/${JOB}/cancel`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_this_environment")
    expect(db.rows("jobs")[0]!.status).toBe("queued")
    expect(refs.refund).toEqual([])
    expect(await gate.describeWait(JOB)).toMatchObject({ position: 1 })
  })

  it("never cancels a queued row no lane parked (no stamp), nor one of another Railway environment of the same name", async () => {
    db.rows("jobs")[0]!.lane_env = null
    expect((await call("POST", `/v1/admin/lanes/jobs/${JOB}/cancel`)).json().error.code).toBe("not_this_environment")
    db.rows("jobs")[0]!.lane_env = "production"
    db.rows("jobs")[0]!.lane_env_id = "env-other"
    expect((await call("POST", `/v1/admin/lanes/jobs/${JOB}/cancel`)).json().error.code).toBe("not_this_environment")
    expect(db.rows("jobs")[0]!.status).toBe("queued")
    expect(refs.refund).toEqual([])
  })

  it("before the lane columns are in this database, nothing was parked by a lane: nothing to cancel", async () => {
    db.missingColumns.add("jobs.lane_env")
    const res = await call("POST", `/v1/admin/lanes/jobs/${JOB}/cancel`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_this_environment")
    expect(db.rows("jobs")[0]!.status).toBe("queued")
    resetLaneColumnsForTests()
  })

  it("is operator-only", async () => {
    expect((await call("POST", `/v1/admin/lanes/jobs/${JOB}/cancel`, PAYER)).statusCode).toBe(403)
    expect(db.rows("jobs")[0]!.status).toBe("queued")
  })

  it("refuses a job that is not waiting for a slot, and one that does not exist", async () => {
    db.rows("jobs")[0]!.status = "processing"
    const res = await call("POST", `/v1/admin/lanes/jobs/${JOB}/cancel`)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("not_queued")
    expect(refs.refund).toEqual([])
    expect((await call("POST", "/v1/admin/lanes/jobs/00000000-0000-4000-8000-00000000f999/cancel")).statusCode).toBe(404)
    expect((await call("POST", "/v1/admin/lanes/jobs/nope/cancel")).statusCode).toBe(400)
  })
})

describe("GET /v1/admin/lanes/history", () => {
  beforeEach(() => {
    db.rows("lane_usage_daily").push(
      { day: "2026-10-29", runtime_env: "production", user_id: USER, payer: `user:${USER}`, peak_running: { provider: 2 }, peak_over_limit: { provider: 1 }, minutes_at_limit: 3, queue_timeouts: 1 },
      { day: "2026-10-30", runtime_env: "production", user_id: USER, payer: `user:${USER}`, peak_running: { provider: 4 }, minutes_at_limit: 5 },
      { day: "2026-10-30", runtime_env: "production", user_id: OTHER, payer: `user:${OTHER}`, minutes_at_limit: 1 },
      { day: "2026-10-30", runtime_env: "staging", user_id: OTHER, payer: `user:${OTHER}`, minutes_at_limit: 500 },
      { day: "2026-08-01", runtime_env: "production", user_id: OTHER, payer: `user:${OTHER}`, minutes_at_limit: 900 },
    )
    db.rows("lane_provider_daily").push(
      { day: "2026-10-30", runtime_env: "production", provider: "kie", peak_running: 40, ceiling: 50, completed: 900, failed: 12, minutes_at_ceiling: 0 },
      { day: "2026-10-30", runtime_env: "staging", provider: "kie", peak_running: 2, ceiling: null, completed: 1, failed: 0, minutes_at_ceiling: 0 },
    )
    db.rows("lane_history_days").push({ day: "2026-10-30", runtime_env: "production", sampled_minutes: 720, enforced_minutes: 0 })
  })

  it("the users view: this environment's last 30 days, per line over the window, the most constrained first", async () => {
    const body = (await call("GET", "/v1/admin/lanes/history")).json()
    expect(body).toMatchObject({ view: "users", available: true, env: "production", days: 30, from: "2026-10-01", truncated: false })
    expect(body.sampled).toEqual([{ day: "2026-10-30", sampledMinutes: 720, enforcedMinutes: 0 }])
    expect(body.users.map((u: { userId: string }) => u.userId)).toEqual([USER, OTHER])
    expect(body.users[0]).toMatchObject({
      email: "dana@example.com", activeDays: 2, minutesAtLimit: 8, queueTimeouts: 1,
      peakRunning: { provider: 4, llm: 0, local: 0, run: 0 }, peakOverLimit: { provider: 1, llm: 0, local: 0, run: 0 },
    })
    expect(body.byDay).toEqual([
      { day: "2026-10-29", lines: 1, minutesAtLimit: 3, queueTimeouts: 1, liveWaitExpiries: 0, peakOverLimit: 1 },
      { day: "2026-10-30", lines: 2, minutesAtLimit: 6, queueTimeouts: 0, liveWaitExpiries: 0, peakOverLimit: 0 },
    ])
  })

  it("the providers view", async () => {
    const body = (await call("GET", "/v1/admin/lanes/history?view=providers&days=7")).json()
    expect(body).toMatchObject({ view: "providers", days: 7, from: "2026-10-24" })
    expect(body.rows).toEqual([{ day: "2026-10-30", provider: "kie", peakRunning: 40, ceiling: 50, completed: 900, failed: 12, minutesAtCeiling: 0 }])
  })

  it("days is capped at 90, and a bad query is a 400", async () => {
    const body = (await call("GET", "/v1/admin/lanes/history?days=500")).json()
    expect(body).toMatchObject({ days: 90, from: "2026-08-02" })
    expect(body.users.find((u: { userId: string }) => u.userId === OTHER).minutesAtLimit).toBe(1)
    expect((await call("GET", "/v1/admin/lanes/history?days=0")).statusCode).toBe(400)
    expect((await call("GET", "/v1/admin/lanes/history?view=servers")).statusCode).toBe(400)
  })

  it("pages through more rows than one request answers", async () => {
    const rows = db.rows("lane_provider_daily")
    for (let i = 0; i < 2_500; i++) rows.push({ day: "2026-10-30", runtime_env: "production", provider: `p${i}`, peak_running: 1, completed: 0, failed: 0, minutes_at_ceiling: 0 })
    const body = (await call("GET", "/v1/admin/lanes/history?view=providers")).json()
    expect(body.rows).toHaveLength(2_501)
    expect(body.truncated).toBe(false)
  })

  it("pages in a total order, so rows of one day are never repeated or skipped across pages", async () => {
    db.shuffleTies = true
    const rows = db.rows("lane_usage_daily")
    for (let i = 0; i < 2_400; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
      rows.push({ day: "2026-10-30", runtime_env: "production", user_id: id, payer: `user:${id}`, minutes_at_limit: 1 })
    }
    const body = (await call("GET", "/v1/admin/lanes/history?view=users")).json()
    expect(body.byDay.find((d: { day: string }) => d.day === "2026-10-30").lines).toBe(2_400 + 2)
    const prov = db.rows("lane_provider_daily")
    for (let i = 0; i < 2_400; i++) prov.push({ day: "2026-10-30", runtime_env: "production", provider: `p${i}`, peak_running: 1, completed: 0, failed: 0, minutes_at_ceiling: 0 })
    const providers = (await call("GET", "/v1/admin/lanes/history?view=providers")).json()
    expect(new Set(providers.rows.map((r: { provider: string }) => r.provider)).size).toBe(2_401)
  })

  it("past the row cap it leaves out the OLDEST days, and says so", async () => {
    const { HISTORY_ROW_CAP } = await import("../../concurrency-lanes/history-read.js")
    const prov = db.rows("lane_provider_daily")
    prov.length = 0
    for (let i = 0; i < 300; i++) prov.push({ day: "2026-10-02", runtime_env: "production", provider: `old${i}`, peak_running: 1 })
    for (let i = 0; i < HISTORY_ROW_CAP; i++) prov.push({ day: "2026-10-30", runtime_env: "production", provider: `p${String(i).padStart(6, "0")}`, peak_running: 1 })
    const body = (await call("GET", "/v1/admin/lanes/history?view=providers")).json()
    expect(body.truncated).toBe(true)
    expect(body.rows).toHaveLength(HISTORY_ROW_CAP)
    expect(body.rows.every((r: { day: string }) => r.day === "2026-10-30")).toBe(true)
  })

  it("is empty and says so while the history tables are not in this database", async () => {
    db.missingTables.add("lane_usage_daily")
    db.missingTables.add("lane_provider_daily")
    const res = await call("GET", "/v1/admin/lanes/history")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ available: false, users: [], byDay: [] })
    expect((await call("GET", "/v1/admin/lanes/history?view=providers")).json()).toMatchObject({ available: false, rows: [] })
  })

  it("answers an admin in the app only", async () => {
    expect((await call("GET", "/v1/admin/lanes/history", ADMIN, "api_token")).statusCode).toBe(403)
  })
})
