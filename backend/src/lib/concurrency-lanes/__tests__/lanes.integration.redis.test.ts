// @test-reads-none an in-memory database double, a real Redis and BullMQ; reads no repo file
// Per-user concurrency lanes end to end, with lanes ENFORCED, on a real Redis
// (the gate's real Lua) and real BullMQ queues (decided 2026-10-30): jobs
// enter through the MCP `generate_image` tool and the real /v1/generate-image
// route, wait parked on BullMQ's delayed set, are woken by the slot a finished
// job reserves for them, and all complete.
//
// The worker below is the video worker's admission sequence and nothing else
// — read the row, admitOrPark, the pickup claim on pickupStatusesFor, run the
// handler under the admission's hold, release exactly once — with the provider
// call stubbed (held open until a case lets it finish). The video worker's own
// wiring of these same functions is pinned by workers/__tests__/video-worker.test.ts.
// The database is an in-memory double; sizes are the code defaults of the
// payer's plan (a personal line on Basic: 4 provider slots; a workspace line on
// its business grade). The server share is left unsized here (it only counts):
// its refusals are server-share.test.ts's.
//
// Skipped (not failed) when no Redis is reachable; CI's "FFmpeg Ledger (real
// Redis)" job sets FFMPEG_LEDGER_REQUIRE_REDIS=1, where an unreachable Redis
// FAILS. Talks to FFMPEG_LEDGER_TEST_REDIS_URL, else localhost:6379 — never
// REDIS_URL — on logical database `dbIndex`. Every BullMQ key of the run lives
// under a random prefix (the route's queue, the worker, and the queues the park
// module opens to promote a waiter — asserted before any job is added) and
// every gate key under another; only those two prefixes are deleted afterwards,
// so runs of several checkouts on one Redis never touch each other.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import IORedis from "ioredis"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { makeSweepDb, type SweepDb } from "./fake-sweep-db.js"

const refs = vi.hoisted(() => ({
  url: process.env.FFMPEG_LEDGER_TEST_REDIS_URL ?? "redis://localhost:6379",
  /** The logical database every connection of this file selects. */
  dbIndex: 11,
  bullPrefix: `bull-lanes-it-${globalThis.crypto.randomUUID()}`,
  lanePrefix: `cl:test:${globalThis.crypto.randomUUID()}:`,
  db: null as unknown as { client: { from(t: string): unknown; rpc(fn: string, args?: unknown): unknown } },
  redis: null as unknown,
  gate: null as unknown,
}))

// Every BullMQ object of this file lives under the run's prefix.
vi.mock("bullmq", async (importOriginal) => {
  const real = await importOriginal<typeof import("bullmq")>()
  type QueueOpts = ConstructorParameters<typeof real.Queue>[1]
  type WorkerOpts = ConstructorParameters<typeof real.Worker>[2]
  class Queue<D = unknown> extends real.Queue<D> {
    constructor(name: string, opts?: QueueOpts) {
      super(name, { ...(opts as object), prefix: refs.bullPrefix } as QueueOpts)
    }
  }
  class Worker extends real.Worker {
    constructor(name: string, processor: ConstructorParameters<typeof real.Worker>[1], opts?: WorkerOpts) {
      super(name, processor, { ...(opts as object), prefix: refs.bullPrefix } as WorkerOpts)
    }
  }
  return { ...real, Queue, Worker }
})
// Defense in depth: were any module handed the real queue module, it would
// still connect to the test database, never to the developer's REDIS_URL.
vi.mock("../../config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../config.js")>()
  const url = new URL(refs.url)
  url.pathname = `/${refs.dbIndex}`
  return { ...real, config: { ...real.config, REDIS_URL: url.toString() } }
})
// The route's queue, with the real queue's default options, on the test Redis.
vi.mock("../../queue.js", async () => {
  const { default: Redis } = await import("ioredis")
  const { Queue } = await import("bullmq")
  const redis = new Redis(refs.url, { db: refs.dbIndex, maxRetriesPerRequest: null })
  redis.on("error", () => undefined)
  refs.redis = redis
  // The prefix is named here too: an import inside a mock factory may be handed the unmocked module.
  const videoQueue = new Queue("video-generation", {
    connection: redis,
    prefix: refs.bullPrefix,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
      priority: 1,
    },
  })
  return { redis, videoQueue, tryRemoveFromQueue: async () => undefined }
})
vi.mock("../instance.js", async () => {
  const { ConcurrencyGate } = await import("../gate.js")
  return {
    concurrencyGate: () => {
      refs.gate ??= new ConcurrencyGate({ client: () => refs.redis as import("ioredis").Redis, prefix: refs.lanePrefix })
      return refs.gate
    },
  }
})
// Sizes: the code defaults of the payer's plan.
vi.mock("../sizes.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sizes.js")>()
  return {
    ...real,
    laneSizesFor: async (s: { payer: string; tier: string | null }) =>
      real.defaultLaneSizesForTier(s.payer.startsWith("workspace:") ? (s.tier ?? "business") : "basic"),
    laneSettings: async () => ({ queueTimeoutMs: 120 * 60_000, liveWaitLimitMs: 10 * 60_000 }),
  }
})
vi.mock("../provider-of.js", () => ({ primaryProviderOfJob: () => "kie" }))
vi.mock("../../supabase.js", () => ({
  supabase: { from: (t: string) => refs.db.client.from(t), rpc: (fn: string, a?: unknown) => refs.db.client.rpc(fn, a) },
}))
// Credits are not what this proves: the guard admits, the reservation answers.
vi.mock("../../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: async () => ({ usageLogId: null, creditsReserved: 1, watermark: false }),
}))

/** Whether a Redis answers. */
async function reachable(): Promise<boolean> {
  const client = new IORedis(refs.url, { db: refs.dbIndex, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 500, enableOfflineQueue: false })
  client.on("error", () => undefined)
  try {
    await client.connect()
    await client.ping()
    return true
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}
const redisUp = await reachable()

describe.runIf(process.env.FFMPEG_LEDGER_REQUIRE_REDIS === "1")("the real-Redis suite is required here", () => {
  it("a Redis is reachable, so the lanes integration below runs instead of skipping", () => {
    expect(redisUp, `no Redis reachable at ${refs.url} (FFMPEG_LEDGER_REQUIRE_REDIS=1)`).toBe(true)
  })
})

type Gate = import("../gate.js").ConcurrencyGate
type Hold = import("../hold.js").ConcurrencyHold
type RowRead = { select(c: string): { eq(c: string, v: string): { maybeSingle(): Promise<{ data: Record<string, unknown> | null }> } } }
type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>

const BASIC_PROVIDER = 4

describe.skipIf(!redisUp)("concurrency lanes, enforced, on Redis and BullMQ", () => {
  let db: SweepDb
  let gate: Gate
  let app: FastifyInstance
  let worker: import("bullmq").Worker
  let workerConnection: IORedis
  let videoQueue: import("bullmq").Queue
  let generateImage: Handler
  let insertInternalJob: typeof import("../../insert-job.js").insertInternalJob
  let mcpSession: { userId: string; scopes: string[]; clientName: string }
  let processor: import("bullmq").Processor
  /** How many times each job reached the processor, and how many times it ran (claimed and started). */
  const runs = new Map<string, number>()
  const started = new Map<string, number>()

  /** A video worker process: a BullMQ worker on its own connection, running `processor`. */
  async function startWorker(): Promise<import("bullmq").Worker> {
    const { Worker } = await import("bullmq")
    workerConnection = new IORedis(refs.url, { db: refs.dbIndex, maxRetriesPerRequest: null })
    workerConnection.on("error", () => undefined)
    const w = new Worker("video-generation", processor, { connection: workerConnection, concurrency: 16 })
    w.on("error", () => undefined)
    return w
  }

  /** The stubbed provider call: each job waits here until a case lets it finish. */
  const provider = {
    finishAll: false,
    running: new Map<string, () => void>(),
    holds: new Map<string, Hold>(),
  }

  /** Who the next request is (the stand-in for the auth hook): user, and an optional workspace. */
  const caller = (req: FastifyRequest): { userId: string; workspaceId: string | null } => ({
    userId: (req.headers["x-internal-user-id"] as string | undefined) ?? (req.headers["x-test-user"] as string),
    workspaceId: (req.headers["x-test-workspace"] as string | undefined) ?? null,
  })

  beforeAll(async () => {
    db = makeSweepDb()
    refs.db = db
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(console, "log").mockImplementation(() => undefined)

    // One at a time, the mocked modules first: a module imported while a mock's
    // async factory is still resolving can be handed the real one.
    await import("../../config.js")
    const { concurrencyGate } = await import("../instance.js")
    const queueModule = await import("../../queue.js")
    expect((queueModule.redis as unknown as { options: { db?: number } }).options.db).toBe(refs.dbIndex)
    const { DelayedError } = await import("bullmq")
    const hold = await import("../hold.js")
    const park = await import("../park.js")
    const admit = await import("../worker-admit.js")
    const insertJob = await import("../../insert-job.js")
    const { default: Fastify } = await import("fastify")
    const { generateImageRoutes } = await import("../../../routes/generate-image.js")
    const { webScrapeRoutes } = await import("../../../routes/web-scrape.js")
    const { registerImageVerbs } = await import("../../mcp/tools/verbs-image.js")
    videoQueue = queueModule.videoQueue as unknown as import("bullmq").Queue
    insertInternalJob = insertJob.insertInternalJob
    park.setLaneQueueConnection(queueModule.redis)
    // Nothing reaches a queue outside the run's prefix (a developer's own queue may live on this Redis).
    const prefixOf = (q: unknown) => (q as { opts: { prefix?: string } }).opts.prefix
    expect(prefixOf(queueModule.videoQueue)).toBe(refs.bullPrefix)
    expect(prefixOf(park.queueOf("video-generation"))).toBe(refs.bullPrefix)
    gate = concurrencyGate() as Gate
    // Every lane module reaches this gate (its keys under the test prefix), never a default one.
    expect(await hold.loadConcurrencyGate()).toBe(gate)
    await gate.setEnforced(true)

    // Parking and wakes as a worker process registers them; no wake
    // subscriber (the releaser promotes its waiter itself).
    park.registerLaneParking()

    // The REST app: the real route behind a stand-in for the auth hook.
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      const who = caller(req)
      const userId = typeof body?.userId === "string" ? body.userId : who.userId
      req.userId = userId
      req.billingContext = who.workspaceId
        ? {
          payer: "workspace", userId, workspaceId: who.workspaceId, orgId: who.workspaceId,
          entitlements: { watermark: false, dailyCapCredits: null, parallelism: 12, tierForGates: "business", freeTierBlocklist: false, webFreeMode: false, appCreditsAllowance: false },
        } as FastifyRequest["billingContext"]
        : { payer: "user", userId }
    })
    await app.register(async (instance) => { await generateImageRoutes(instance) })
    await app.register(async (instance) => { await webScrapeRoutes(instance) })
    await app.ready()

    // The MCP tool, registered on a capturing server, reaching the app through its inject.
    const tools = new Map<string, Handler>()
    const server = { registerTool: (name: string, _def: unknown, handler: Handler) => { tools.set(name, handler) } }
    mcpSession = { userId: "", scopes: ["workflows:execute", "workflows:read", "assets:write"], clientName: "lanes-integration" }
    registerImageVerbs({ server, session: mcpSession, fastify: app } as unknown as Parameters<typeof registerImageVerbs>[0])
    generateImage = tools.get("generate_image")!
    expect(generateImage).toBeDefined()

    // The video worker's admission sequence, the provider stubbed.
    processor = async (job, token) => {
      const { jobId } = job.data as { jobId: string; userId?: string }
      runs.set(jobId, (runs.get(jobId) ?? 0) + 1)
      const { data } = await (db.client.from("jobs") as RowRead).select(admit.WORKER_ROW_COLUMNS).eq("id", jobId).maybeSingle()
      const admission = await admit.admitOrPark({ job, token, queue: "video-generation", row: admit.workerRowOf(jobId, data, (job.data as { userId?: string }).userId) })
      if (!admission) throw new DelayedError()
      let outcome: "completed" | "failed" | "cancelled" = "failed"
      try {
        const claimed = db.rows("jobs").filter((r) => r.id === jobId && admit.pickupStatusesFor(job.id).includes(r.status as never))
        if (claimed.length === 0) {
          outcome = "cancelled"
          return
        }
        // The pickup claim writes the BullMQ name into job_type, as the video worker's does.
        for (const r of claimed) Object.assign(r, { status: "processing", started_at: new Date().toISOString(), job_type: job.name })
        started.set(jobId, (started.get(jobId) ?? 0) + 1)
        await hold.runHolding(admission.hold, async () => {
          provider.holds.set(jobId, hold.currentConcurrencyHold()!)
          if (!provider.finishAll) await new Promise<void>((resolve) => provider.running.set(jobId, resolve))
          provider.running.delete(jobId)
        })
        for (const r of claimed) r.status = "completed"
        outcome = "completed"
      } finally {
        await admission.release(outcome)
      }
    }
    worker = await startWorker()
  }, 30_000)

  /** Let every held provider call finish, and every later one finish at once; wait for all of `jobIds`. */
  async function finishAll(jobIds: readonly string[]): Promise<void> {
    provider.finishAll = true
    for (const done of provider.running.values()) done()
    await vi.waitFor(() => {
      expect(jobIds.filter((id) => db.row("jobs", id)?.status !== "completed")).toEqual([])
    }, { timeout: 30_000, interval: 25 })
  }

  afterEach(async () => {
    provider.finishAll = true
    for (const done of provider.running.values()) done()
    await vi.waitFor(() => expect(db.rows("jobs").filter((r) => r.status !== "completed")).toEqual([]), { timeout: 30_000, interval: 25 })
    // Each case starts from nothing running and nothing recorded.
    provider.running.clear()
    provider.holds.clear()
    provider.finishAll = false
  }, 40_000)

  afterAll(async () => {
    await worker?.close()
    workerConnection?.disconnect()
    const park = await import("../park.js")
    await park.queueOf("video-generation")?.close()
    await videoQueue?.close()
    const redis = refs.redis as import("ioredis").Redis | null
    if (redis) {
      for (const pattern of [`${refs.bullPrefix}:*`, `${refs.lanePrefix}*`]) {
        let cursor = "0"
        do {
          const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500)
          cursor = next
          if (keys.length > 0) await redis.del(...keys)
        } while (cursor !== "0")
      }
      redis.disconnect()
    }
    await app?.close()
    vi.restoreAllMocks()
  }, 30_000)

  const newUser = () => globalThis.crypto.randomUUID()
  const jobsOf = (userId: string) => db.rows("jobs").filter((r) => r.user_id === userId).map((r) => r.id as string)
  const statusOf = (id: string) => db.row("jobs", id)?.status
  const linesOf = async (userId: string) => (await gate.snapshot()).lines.filter((l) => l.userId === userId)

  async function mcpGenerate(userId: string, prompt: string): Promise<void> {
    mcpSession.userId = userId
    const res = await generateImage({ prompt, model: "nano-banana" })
    expect(res.isError, res.content[0]?.text).toBeFalsy()
  }

  async function restGenerate(userId: string, opts: { workspaceId?: string } = {}): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-image",
      headers: { "x-test-user": userId, ...(opts.workspaceId ? { "x-test-workspace": opts.workspaceId } : {}) },
      payload: { prompt: "a lighthouse at dusk", provider: "nano-banana", userId },
    })
    expect(res.statusCode, res.body).toBe(200)
  }

  /** Wait until `n` of the user's jobs run (held in the provider) and `queued` of them wait parked. */
  async function settle(userId: string, n: number, queued: number): Promise<void> {
    await vi.waitFor(() => {
      const ids = jobsOf(userId)
      expect(ids.filter((id) => provider.running.has(id))).toHaveLength(n)
      expect(ids.filter((id) => statusOf(id) === "queued")).toHaveLength(queued)
    }, { timeout: 30_000, interval: 25 })
  }

  async function positions(ids: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    for (const id of ids) {
      const w = await gate.describeWait(id)
      if (w) out.set(id, w.position)
    }
    return out
  }

  it("one user, 50 MCP generate_image calls on Basic: 4 run, 46 queue with exact positions, all complete", async () => {
    const user = newUser()
    for (let i = 0; i < 50; i++) await mcpGenerate(user, `frame ${i}`)
    const ids = jobsOf(user)
    expect(ids).toHaveLength(50)

    await settle(user, BASIC_PROVIDER, 46)
    const [line] = await linesOf(user)
    expect(await linesOf(user)).toHaveLength(1)
    expect(line).toMatchObject({ payer: `user:${user}` })
    expect(line!.lanes.provider).toMatchObject({ running: 4, overLimit: 0, queued: 46 })
    const waiting = ids.filter((id) => statusOf(id) === "queued")
    const before = await positions(waiting)
    expect([...before.values()].sort((a, b) => a - b)).toEqual(Array.from({ length: 46 }, (_, i) => i + 1))
    for (const id of waiting) expect(await gate.describeWait(id), id).toMatchObject({ lane: "provider", limit: 4, running: 4, reason: "user_lane" })
    // Each running job holds a provider slot of its own line.
    for (const id of ids.filter((x) => provider.running.has(x))) {
      expect(provider.holds.get(id)).toMatchObject({ role: "leaf", lane: "provider", payer: `user:${user}` })
      expect(provider.holds.get(id)!.leaseId).toBeTruthy()
    }

    // One finishes: the head of the line starts, and every other waiter moves up by one.
    const head = [...before].find(([, p]) => p === 1)![0]
    const first = ids.find((id) => provider.running.has(id))!
    provider.running.get(first)!()
    await vi.waitFor(() => expect(provider.running.has(head)).toBe(true), { timeout: 30_000, interval: 25 })
    await settle(user, BASIC_PROVIDER, 45)
    const after = await positions(waiting.filter((id) => id !== head))
    for (const [id, p] of after) expect(p, id).toBe(before.get(id)! - 1)

    await finishAll(ids)
    expect(await linesOf(user)).toEqual([])
  }, 90_000)

  it("a workflow run, an MCP fan-out and REST API calls from the same user and payer share one provider line", async () => {
    const user = newUser()
    // A workflow run's node job, created and enqueued as the orchestrator's node executor does it.
    const { data } = await insertInternalJob("orchestrator", {
      user_id: user, status: "pending", workflow_execution_id: globalThis.crypto.randomUUID(),
      input_data: { type: "generate-image", node_id: "n1", prompt: "from the run" },
    })
    await videoQueue.add("generate-image", {
      jobId: (data as { id: string }).id, userId: user, billingContext: { payer: "user", userId: user }, prompt: "from the run", provider: "nano-banana",
    }, { priority: 10 })
    await settle(user, 1, 0)
    // An agent's parallel tool calls, then two REST calls.
    await Promise.all([1, 2, 3].map((i) => mcpGenerate(user, `fan-out ${i}`)))
    await restGenerate(user)
    await restGenerate(user)

    const ids = jobsOf(user)
    expect(ids).toHaveLength(6)
    await settle(user, BASIC_PROVIDER, 2)
    const lines = await linesOf(user)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ payer: `user:${user}` })
    expect(lines[0]!.lanes.provider).toMatchObject({ running: 4, queued: 2 })
    expect(new Set(db.rows("jobs").filter((r) => r.user_id === user).map((r) => r.source))).toEqual(new Set(["internal", "mcp", "api"]))
    expect([...(await positions(ids)).values()].sort()).toEqual([1, 2])

    await finishAll(ids)
  }, 60_000)

  it("a second user's job starts at once", async () => {
    const [user, other] = [newUser(), newUser()]
    for (let i = 0; i < 6; i++) await restGenerate(user)
    await settle(user, BASIC_PROVIDER, 2)
    await restGenerate(other)
    await settle(other, 1, 0)
    const [job] = jobsOf(other)
    expect(await gate.describeWait(job!)).toBeNull()
    expect(provider.holds.get(job!)).toMatchObject({ payer: `user:${other}` })
    await finishAll([...jobsOf(user), ...jobsOf(other)])
  }, 60_000)

  it("the same user's workspace jobs use a separate line", async () => {
    const user = newUser()
    const workspace = globalThis.crypto.randomUUID()
    for (let i = 0; i < 6; i++) await restGenerate(user)
    await settle(user, BASIC_PROVIDER, 2)
    await restGenerate(user, { workspaceId: workspace })
    await settle(user, BASIC_PROVIDER + 1, 2)
    const wsJob = db.rows("jobs").find((r) => r.user_id === user && r.workspace_id === workspace)!.id as string
    expect(provider.holds.get(wsJob)).toMatchObject({ payer: `workspace:${workspace}`, lane: "provider" })
    const lines = await linesOf(user)
    expect(lines.map((l) => [l.payer, l.lanes.provider.running, l.lanes.provider.queued]).sort()).toEqual(
      [[`user:${user}`, 4, 2], [`workspace:${workspace}`, 1, 0]].sort(),
    )
    await finishAll(jobsOf(user))
  }, 60_000)

  /** A Web Scrape answered with a job id, through the real route: its worker job is `web-scrape`. */
  async function restScrape(userId: string): Promise<string> {
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape", headers: { "x-test-user": userId },
      payload: { actor: "google-search", query: "running shoes", respondAsync: true },
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ status: "pending" })
    return res.json().jobId as string
  }

  /** Fill the user's personal provider line with leases of other work; returns them. */
  async function fillProviderLine(userId: string): Promise<string[]> {
    const leases: string[] = []
    for (let i = 0; i < BASIC_PROVIDER; i++) {
      const r = await gate.acquire({
        meta: {
          jobId: `filler-${userId}-${i}`, userId, payer: `user:${userId}`, lane: "provider", provider: "kie", source: null,
          sourceDetail: null, jobType: "generate-image", model: null, queue: "video-generation", bullJobId: null,
        },
        size: BASIC_PROVIDER, mode: "fresh", leaseTtlMs: 3_600_000,
      })
      if (!r.granted) throw new Error("expected a grant")
      leases.push(r.leaseId)
    }
    return leases
  }

  it("a background scrape over its line waits as queued and holds its slot for the whole scrape", async () => {
    const user = newUser()
    for (let i = 0; i < BASIC_PROVIDER; i++) await restGenerate(user)
    await settle(user, BASIC_PROVIDER, 0)
    const scrape = await restScrape(user)
    await settle(user, BASIC_PROVIDER, 1)
    expect(statusOf(scrape)).toBe("queued")
    expect(await gate.describeWait(scrape)).toMatchObject({ lane: "provider", position: 1, reason: "user_lane" })

    // One generation finishes: the scrape starts, under a provider slot of its user's line.
    const first = jobsOf(user).find((id) => provider.running.has(id))!
    provider.running.get(first)!()
    await vi.waitFor(() => expect(provider.running.has(scrape)).toBe(true), { timeout: 30_000, interval: 25 })
    expect(db.row("jobs", scrape)?.job_type).toBe("web-scrape")
    expect(provider.holds.get(scrape)).toMatchObject({ role: "leaf", lane: "provider", payer: `user:${user}`, jobId: scrape })
    expect(provider.holds.get(scrape)!.leaseId).toBeTruthy()
    // Its slot stays taken while the scrape runs, even once every other job is done.
    for (const id of jobsOf(user).filter((x) => x !== scrape && provider.running.has(x))) provider.running.get(id)!()
    await vi.waitFor(() => expect(jobsOf(user).filter((id) => id !== scrape && statusOf(id) !== "completed")).toEqual([]), { timeout: 30_000, interval: 25 })
    expect((await linesOf(user))[0]!.lanes.provider).toMatchObject({ running: 1, queued: 0 })

    await finishAll(jobsOf(user))
    expect(await linesOf(user)).toEqual([])
  }, 60_000)

  it("a background scrape survives a worker restart while queued: it runs once, on the new worker", async () => {
    const user = newUser()
    const leases = await fillProviderLine(user)
    const scrape = await restScrape(user)
    await vi.waitFor(() => expect(statusOf(scrape)).toBe("queued"), { timeout: 30_000, interval: 25 })
    expect(started.get(scrape)).toBeUndefined()

    // The worker goes away (a deploy) and a new one starts.
    await worker.close()
    workerConnection.disconnect()
    worker = await startWorker()

    // A slot frees: the waiter it was reserved for is promoted, and the new worker runs it.
    const park = await import("../park.js")
    await park.wakeTargets(await gate.release(leases[0]!, "completed"))
    await vi.waitFor(() => expect(provider.running.has(scrape)).toBe(true), { timeout: 30_000, interval: 25 })
    await finishAll([scrape])
    expect(started.get(scrape)).toBe(1)
    expect(db.row("jobs", scrape)?.job_type).toBe("web-scrape")
    for (const l of leases.slice(1)) await gate.release(l, "completed")
  }, 60_000)
})

