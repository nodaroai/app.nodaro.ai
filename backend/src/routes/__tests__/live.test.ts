// Live routes wait for their lane slot BEFORE they reserve credits, through
// the real route modules under the request scope: an LLM JSON route, an LLM
// stream (which waits inside the stream and tells its client), a scraper in
// its synchronous mode (whose LLM analysis runs under the scraper's slot) and
// the voice routes. With lanes locked — the default this release — nothing
// waits, nothing is refused and no answer changes.
import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// These tests wait for slots, so they run on the path where limits can be
// turned on (test-only: this release locks them, and a locked take never waits).
vi.mock("../../lib/concurrency-lanes/enforcement-available.js", () => ({ LANES_ENFORCEMENT_AVAILABLE: true }))
import { ConcurrencyGate, type WakeTarget } from "../../lib/concurrency-lanes/gate.js"
import type { LaneSizes } from "../../lib/concurrency-lanes/types.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"

const refs = vi.hoisted(() => ({
  gate: null as unknown,
  sizes: { provider: 1, llm: 1, local: 2, run: 1 } as LaneSizes,
  settings: { queueTimeoutMs: 3_600_000, liveWaitLimitMs: 600_000 },
  onWake: null as null | ((targets: WakeTarget[]) => Promise<void>),
}))
vi.mock("../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => refs.gate }))
vi.mock("../../lib/concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => refs.sizes,
  laneSettings: async () => refs.settings,
}))
vi.mock("../../lib/concurrency-lanes/wake-subscriber.js", () => ({
  startLaneWakeSubscriber: (_queues: string[], onWake: (targets: WakeTarget[]) => Promise<void>) => {
    refs.onWake = onWake
    return () => undefined
  },
}))

const m = vi.hoisted(() => ({
  db: { current: undefined as unknown as ReturnType<typeof import("../../lib/__tests__/jobs-schema.js").strictJobsSupabase> },
  /** The credit CHECK every route's creditGuard preHandler runs (it reserves nothing). */
  creditCheck: vi.fn(async () => undefined),
  /** The credit RESERVATION the handlers make. */
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "ul-1", creditsReserved: 1, watermark: false })),
  commitCredits: vi.fn(async () => undefined),
  refundCredits: vi.fn(async () => undefined),
  markJobFailed: vi.fn(async () => true),
  markJobCompleted: vi.fn(async () => true),
  llmComplete: vi.fn(),
  llmStream: vi.fn(),
  queueAdd: vi.fn(async () => undefined),
  suno: { validate: vi.fn(), generate: vi.fn() },
  metaAds: { run: vi.fn() },
  /** When on, the LLM routes take the metered branch (the default in production). */
  metered: { on: false, settle: vi.fn(async (..._args: unknown[]) => ({ outcome: "refunded" as const })) },
  /** The approvals' creature row, and the caption call / its optional hold. */
  creatures: [] as Array<Record<string, unknown>>,
  caption: vi.fn(),
  meterOptional: vi.fn(),
  analyze: vi.fn(),
}))

/** A one-row `creatures` table: enough for an approval to read and update its row. */
function creaturesTable() {
  let patch: Record<string, unknown> | null = null
  const answer = async () => {
    const row = m.creatures[0]
    if (!row) return { data: null, error: { message: "not found" } }
    if (patch) Object.assign(row, patch)
    return { data: { ...row }, error: null }
  }
  const b = {
    select: () => b,
    update: (p: Record<string, unknown>) => { patch = p; return b },
    eq: () => b,
    is: () => b,
    single: answer,
  }
  return b
}
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => (table === "creatures" ? creaturesTable() : m.db.current.client.from(table)),
    rpc: () => m.db.current.client.rpc(),
  },
}))
vi.mock("../../lib/config.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/config.js")>()
  // Tier pricing (the metered hold is Cloud code); every key a route asks for.
  return {
    ...real,
    config: { ...real.config, KIE_API_KEY: "k".repeat(40), ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "", APIFY_API_TOKEN: "a".repeat(40) },
    hasAdmin: () => false,
    llmMeteredPricing: () => m.metered.on,
  }
})
vi.mock("../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => m.creditCheck,
  reserveCreditsForJob: m.reserveCreditsForJob,
}))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: { commitCredits: m.commitCredits, refundCredits: m.refundCredits, getModelCreditCost: vi.fn().mockResolvedValue(1) },
}))
vi.mock("../../lib/llm-billing.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/llm-billing.js")>()
  return {
    ...real,
    reserveLlmCall: async (...args: Parameters<typeof real.reserveLlmCall>) => m.metered.on
      ? { metered: true, reservation: { usageLogId: "ul-1", creditsReserved: 1, watermark: false }, chargeId: "charge-1", holdCredits: 1 }
      : real.reserveLlmCall(...args),
    stampSyncLlmCallStart: async (...args: Parameters<typeof real.stampSyncLlmCallStart>) => m.metered.on || real.stampSyncLlmCallStart(...args),
    settleLlmJob: (...args: Parameters<typeof real.settleLlmJob>) => m.metered.on ? m.metered.settle(...args) : real.settleLlmJob(...args),
  }
})
vi.mock("../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: vi.fn(async () => undefined),
  refundReservedCreditsForJob: vi.fn(async () => undefined),
}))
vi.mock("../../lib/credit-base-cost.js", () => ({ baseCreditCostFor: vi.fn(async () => 1) }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: m.markJobFailed }))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: m.markJobCompleted, commitJobCredits: vi.fn(async () => undefined) }))
vi.mock("../../lib/creature-caption.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/creature-caption.js")>()),
  captionCreatureCall: m.caption,
}))
vi.mock("../../lib/meter-sync-llm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/meter-sync-llm.js")>()),
  meterOptionalSyncLlm: m.meterOptional,
}))
vi.mock("../../lib/cloud-llm-proxy.js", () => ({
  maybeProxyLlmRouteToCloud: vi.fn(async () => false),
  maybeProxyLlmStreamToCloud: vi.fn(async () => false),
}))
vi.mock("../../lib/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm-client.js")>()),
  llmComplete: m.llmComplete,
  llmStream: m.llmStream,
}))
vi.mock("../../lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, renderQueue: { add: vi.fn() }, redis: {}, tryRemoveFromQueue: vi.fn() }))
vi.mock("../../lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("../../providers/kie/suno-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers/kie/suno-client.js")>()),
  sunoVoiceValidate: m.suno.validate,
  sunoVoiceGenerate: m.suno.generate,
}))
vi.mock("../../providers/apify/meta-ads.js", () => ({ runMetaAdsScrape: m.metaAds.run }))
vi.mock("../../providers/apify/meta-ads-advertisers.js", () => ({ searchMetaAdvertisers: vi.fn() }))
vi.mock("../../lib/meta-ads-media.js", () => ({
  classifyAndStoreMetaAdsMedia: vi.fn(async (ads: unknown[]) => ({
    ads, stats: { classified: 0, stored: 0, videosStored: 0, kept: ads.length, filteredOut: 0 },
  })),
  metaAdsWithoutMedia: (ads: unknown[]) => ads,
}))
vi.mock("../../lib/meta-ads-analysis.js", () => ({ analyzeMetaAds: m.analyze }))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: vi.fn(async () => false) }))

const { strictJobsSupabase } = await import("../../lib/__tests__/jobs-schema.js")
const { installLaneRequestScope } = await import("../../lib/concurrency-lanes/request-scope.js")
const { currentConcurrencyHold, resetLaneCountersForTests, runHolding } = await import("../../lib/concurrency-lanes/hold.js")
const { resetConcurrencySlotsForTests, withConcurrencySlot } = await import("../../lib/concurrency-lanes/slot.js")
const { resetHistoryHooksForTests } = await import("../../lib/concurrency-lanes/history-hooks.js")
const { laneClassOf } = await import("../../lib/concurrency-lanes/registry.js")
const { llmChatRoutes } = await import("../llm-chat.js")
const { metaAdsScrapeRoutes } = await import("../meta-ads-scrape.js")
const { sunoRoutes } = await import("../suno.js")
const { voiceDesignRoutes } = await import("../voice-design.js")
const { voiceCloneRoutes } = await import("../voice-clones.js")
const { aiWriterRoutes } = await import("../ai-writer.js")
const { describeToPickerRoutes } = await import("../describe-to-picker.js")
const { creatureMainImageApprovalRoutes } = await import("../creature-main-image-approval.js")
const { refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")

/** The real fetch, for a real client. */
const realFetch: typeof fetch = globalThis.fetch

const USER = "00000000-0000-4000-8000-000000000001"
const seen: Record<string, unknown> = {}

let gate: ConcurrencyGate
let app: FastifyInstance

async function buildApp(opts: { scoped: boolean }): Promise<FastifyInstance> {
  const a = Fastify()
  if (opts.scoped) installLaneRequestScope(a)
  // inject's fake request and response have no socket for the routes' socket-timeout extension.
  a.addHook("onRequest", async (req, reply) => {
    ;(req.raw as { setTimeout: (ms: number) => void }).setTimeout = () => undefined
    ;(reply.raw as { setTimeout: (ms: number) => void }).setTimeout = () => undefined
  })
  // A stand-in for the auth hook.
  a.addHook("preHandler", async (req) => {
    const user = req.headers["x-user"]
    if (typeof user === "string") req.userId = user
  })
  await a.register(llmChatRoutes)
  await a.register(metaAdsScrapeRoutes)
  await a.register(async (i) => sunoRoutes(i))
  await a.register(voiceDesignRoutes)
  await a.register(voiceCloneRoutes)
  await a.register(aiWriterRoutes)
  await a.register(describeToPickerRoutes)
  await a.register(creatureMainImageApprovalRoutes)
  await a.ready()
  return a
}

const otherMeta = (jobId: string, lane: "provider" | "llm") => ({
  jobId, userId: USER, payer: `user:${USER}` as const, lane, provider: "kie", source: null, sourceDetail: null,
  jobType: "image-to-video", model: null, queue: "video-generation" as const, bullJobId: jobId,
})

/** Fills the user's `lane` with other jobs; returns their leases. */
async function fillLane(lane: "provider" | "llm"): Promise<string[]> {
  const leases: string[] = []
  for (let i = 0; i < refs.sizes[lane]; i++) {
    const r = await gate.acquire({ meta: otherMeta(`other-${lane}-${i}`, lane), size: refs.sizes[lane], mode: "fresh", leaseTtlMs: 3_600_000 })
    if (!r.granted) throw new Error("expected a grant")
    leases.push(r.leaseId)
  }
  return leases
}

/** Frees one filler and wakes whoever waits behind it. */
async function freeOne(leaseId: string): Promise<void> {
  await refs.onWake!(await gate.release(leaseId, "completed"))
}

const laneOf = async (lane: "provider" | "llm") => (await gate.snapshot()).lines[0]?.lanes[lane]

async function until(check: () => Promise<boolean> | boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error("condition not met in time")
    await new Promise((r) => setTimeout(r, 5))
  }
}

const post = (url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}, on = app) =>
  on.inject({ method: "POST", url, headers: { "x-user": USER, ...headers }, payload })

const CHAT = { systemPrompt: "", userInput: "hi", llmModel: "gemini-3.6-flash" }
const AD = { adArchiveId: "1", pageName: "Nike", title: "Air Max", text: "Just do it.", images: [], videos: [], videoPreviews: [] }
const META_ADS = { mode: "search", query: "running shoes", analyze: true }
const VOICE_DESIGN = { text: "x".repeat(120), voiceDescription: "a warm, low voice" }
const WRITER = { systemPrompt: "", userInput: "a shoe ad", llmModel: "gemini-3.6-flash" }
const PICKER = { imageUrl: "https://cdn.test/img.png", targetPickers: ["person"] }
const CREATURE_ID = "00000000-0000-4000-8000-0000000000c1"
const APPROVE = { candidateJobId: "00000000-0000-4000-8000-0000000000a1" }
const APPROVE_URL = `/v1/creatures/${CREATURE_ID}/approve-main-image`
const BUSY = "Busy right now — try again in a few minutes."

/** The `data:` events of an SSE body, in order. */
const sseEvents = (body: string) =>
  body.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice("data: ".length)) as { type: string; data: unknown })

/** The approval's creature and its completed candidate, fresh. */
function seedApproval(): void {
  m.creatures = [{ id: CREATURE_ID, source_image_url: null, canonical_description: null, updated_at: "2026-11-01T00:00:00.000Z" }]
  m.db.current = strictJobsSupabase([{ id: APPROVE.candidateJobId, user_id: USER, status: "completed", output_data: { imageUrl: "https://cdn.test/c.png" }, input_data: {} }])
}

/** A body with its server-made ids blanked, to compare two answers. */
const withoutIds = (body: string) => body.replace(/job-\d+/g, "job-N")

beforeEach(async () => {
  m.db.current = strictJobsSupabase()
  for (const fn of [m.creditCheck, m.reserveCreditsForJob, m.commitCredits, m.refundCredits, m.markJobFailed, m.markJobCompleted, m.queueAdd, m.suno.validate, m.suno.generate, m.metaAds.run, m.analyze, m.llmComplete, m.llmStream]) fn.mockClear()
  m.llmComplete.mockImplementation(async () => ({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } }))
  m.llmStream.mockImplementation(async (_req: unknown, onToken: (t: string) => void) => {
    onToken("Hel")
    onToken("lo")
    return { text: "Hello", usage: { inputTokens: 1, outputTokens: 2 } }
  })
  m.suno.validate.mockImplementation(async () => ({ taskId: "kie-validate-1" }))
  m.suno.generate.mockImplementation(async () => ({ taskId: "kie-generate-1" }))
  m.metaAds.run.mockImplementation(async () => ({ json: [AD] }))
  m.analyze.mockImplementation(async (ads: unknown[]) => {
    // The analysis's own LLM call, through the funnel it really uses.
    seen.analysisHold = currentConcurrencyHold()
    await withConcurrencySlot({ lane: "llm", provider: "kie", jobType: "meta-ads-analysis" }, async () => {
      seen.analysisCallHold = currentConcurrencyHold()
    })
    return { ads, stats: { analyzed: ads.length, failed: 0, skipped: 0, providerCostUsd: 0 } }
  })
  m.metered.on = false
  m.metered.settle.mockClear()
  m.creatures = []
  m.caption.mockReset()
  m.caption.mockImplementation(async () => ({ caption: "a small blue dragon", request: {}, outcome: { response: {} } }))
  m.meterOptional.mockReset()
  m.meterOptional.mockImplementation(async () => ({ meter: { spend: { add: () => undefined }, settle: vi.fn(async () => undefined) } }))
  vi.mocked(refundReservedCreditsForJob).mockClear()
  for (const k of Object.keys(seen)) delete seen[k]
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  refs.gate = gate
  refs.sizes = { provider: 1, llm: 1, local: 2, run: 1 }
  refs.settings = { queueTimeoutMs: 3_600_000, liveWaitLimitMs: 600_000 }
  refs.onWake = null
  resetLaneCountersForTests()
  resetConcurrencySlotsForTests()
  resetHistoryHooksForTests()
  await gate.setEnforced(true)
  app = await buildApp({ scoped: true })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await app.close()
})

describe("an LLM route takes its slot before it reserves", () => {
  it("admits at once with a free slot", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const res = await post("/v1/llm-chat/generate", CHAT)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ generatedText: "ok" })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0].meta).toMatchObject({ lane: "llm", provider: "kie", jobType: "/v1/llm-chat/generate", queue: "live" })
    // The credit check, then the slot, then the reservation.
    expect(m.creditCheck.mock.invocationCallOrder[0]!).toBeLessThan(acquire.mock.invocationCallOrder[0]!)
    expect(acquire.mock.invocationCallOrder[0]!).toBeLessThan(m.reserveCreditsForJob.mock.invocationCallOrder[0]!)
    await until(async () => ((await laneOf("llm"))?.running ?? 0) === 0)
  })

  it("waits and then runs when a slot frees", async () => {
    const [other] = await fillLane("llm")
    let res: Awaited<ReturnType<typeof post>> | undefined
    const p = post("/v1/llm-chat/generate", CHAT).then((r) => { res = r })
    await until(async () => (await laneOf("llm"))?.queued === 1)
    // Waiting: checked, but nothing reserved, no job, no call.
    expect(m.creditCheck).toHaveBeenCalledTimes(1)
    expect(m.reserveCreditsForJob).not.toHaveBeenCalled()
    expect(m.db.current.jobs).toHaveLength(0)
    expect(m.llmComplete).not.toHaveBeenCalled()
    await freeOne(other!)
    await p
    expect(res?.statusCode).toBe(200)
    expect(m.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(m.llmComplete).toHaveBeenCalledTimes(1)
  })

  it("a client that disconnects while waiting never reaches credit reservation", async () => {
    await fillLane("llm")
    const withdraw = vi.spyOn(gate, "withdraw")
    await app.listen({ port: 0, host: "127.0.0.1" })
    const address = app.server.address()
    const port = typeof address === "object" && address ? address.port : 0
    const client = new AbortController()
    const call = realFetch(`http://127.0.0.1:${port}/v1/llm-chat/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": USER },
      body: JSON.stringify(CHAT),
      signal: client.signal,
    }).catch((err: unknown) => err)
    await until(async () => (await laneOf("llm"))?.queued === 1)
    client.abort()
    await call
    await until(() => withdraw.mock.calls.length === 1)
    await until(async () => ((await laneOf("llm"))?.queued ?? 0) === 0)
    // Give a (wrong) handler every chance to run.
    await new Promise((r) => setTimeout(r, 50))
    expect(m.creditCheck).toHaveBeenCalledTimes(1)
    expect(m.reserveCreditsForJob).not.toHaveBeenCalled()
    expect(m.db.current.jobs).toHaveLength(0)
    expect(m.llmComplete).not.toHaveBeenCalled()
  })

  it("answers 503 lane_busy after the live-wait limit with nothing reserved", async () => {
    refs.settings = { ...refs.settings, liveWaitLimitMs: 40 }
    await fillLane("llm")
    const res = await post("/v1/llm-chat/generate", CHAT)
    expect(res.statusCode).toBe(503)
    expect(res.headers["retry-after"]).toBe("60")
    expect(res.json()).toEqual({ error: { code: "lane_busy", message: "Busy right now — try again in a few minutes." } })
    expect(m.creditCheck).toHaveBeenCalledTimes(1)
    expect(m.reserveCreditsForJob).not.toHaveBeenCalled()
    expect(m.db.current.jobs).toHaveLength(0)
    expect(m.llmComplete).not.toHaveBeenCalled()
  })
})

describe("an LLM stream takes its slot inside the stream", () => {
  const STREAM = { accept: "text/event-stream" }

  it("stream emits metadata queue events then tokens", async () => {
    const [other] = await fillLane("llm")
    let res: Awaited<ReturnType<typeof post>> | undefined
    const p = post("/v1/llm-chat/generate-stream", CHAT, STREAM).then((r) => { res = r })
    await until(async () => (await laneOf("llm"))?.queued === 1)
    expect(m.llmStream).not.toHaveBeenCalled()
    await freeOne(other!)
    await p
    const events = sseEvents(res!.body)
    const types = events.map((e) => e.type)
    const firstQueue = events.findIndex((e) => e.type === "metadata" && (e.data as { queue?: unknown }).queue)
    const firstToken = types.indexOf("token")
    expect(events[0]).toMatchObject({ type: "metadata", data: { jobId: expect.any(String), model: "gemini-3.6-flash" } })
    expect(firstQueue).toBeGreaterThan(0)
    // Every queue event names the job, so a client reading the latest keeps it.
    expect(events[firstQueue]!.data).toEqual({ jobId: (events[0]!.data as { jobId: string }).jobId, queue: { lane: "llm", position: 1, waitedMs: expect.any(Number) } })
    expect(firstToken).toBeGreaterThan(firstQueue)
    expect(types.slice(firstToken)).toEqual(["token", "token", "done"])
    expect(m.llmStream).toHaveBeenCalledTimes(1)
  })

  it("a stream that waited stamps its provider call's start at the grant, not before the wait", async () => {
    for (const url of ["/v1/llm-chat/generate-stream", "/v1/ai-writer/generate-stream"]) {
      m.db.current = strictJobsSupabase()
      const [other] = await fillLane("llm")
      let res: Awaited<ReturnType<typeof post>> | undefined
      const p = post(url, CHAT, STREAM).then((r) => { res = r })
      await until(async () => (await laneOf("llm"))?.queued === 1)
      const firstStamp = String(m.db.current.jobs[0]!.provider_call_started_at)
      await new Promise((r) => setTimeout(r, 20))
      const freedAt = new Date().toISOString()
      await freeOne(other!)
      await p
      expect(res?.statusCode).toBe(200)
      // Stamped before the wait, then again once the slot was granted: the
      // reconcile sweep's clock starts at the call.
      expect(firstStamp < freedAt).toBe(true)
      expect(String(m.db.current.jobs[0]!.provider_call_started_at) >= freedAt).toBe(true)
      expect(m.db.current.jobs[0]!.provider_kind).toBe("anthropic-sync")
      await until(async () => ((await laneOf("llm"))?.running ?? 0) === 0)
    }
  })

  /** Each stream's refusal, on both billing branches. */
  const refusals: Array<{ name: string; url: string; body: Record<string, unknown>; tierRefund: () => unknown[][] }> = [
    { name: "Generate Text", url: "/v1/llm-chat/generate-stream", body: CHAT, tierRefund: () => m.refundCredits.mock.calls },
    { name: "AI Writer", url: "/v1/ai-writer/generate-stream", body: WRITER, tierRefund: () => m.refundCredits.mock.calls },
    { name: "describe-to-picker", url: "/v1/describe-to-picker", body: PICKER, tierRefund: () => vi.mocked(refundReservedCreditsForJob).mock.calls },
  ]
  for (const r of refusals) {
    it(`${r.name}: a stream that never gets its slot ends in lane_busy, its job failed and its reservation refunded once`, async () => {
      refs.settings = { ...refs.settings, liveWaitLimitMs: 40 }
      await fillLane("llm")
      const res = await post(r.url, r.body, STREAM)
      expect(sseEvents(res.body).at(-1)).toEqual({ type: "error", data: { code: "lane_busy", message: BUSY } })
      expect(m.llmStream).not.toHaveBeenCalled()
      expect(m.markJobFailed).toHaveBeenCalledTimes(1)
      expect(r.tierRefund()).toHaveLength(1)
      expect(r.tierRefund()[0]![0]).toBe(r.url === "/v1/describe-to-picker" ? m.db.current.jobs[0]!.id : "ul-1")
    })

    it(`${r.name}: a metered stream that never gets its slot settles as billing nothing and ends in lane_busy`, async () => {
      m.metered.on = true
      refs.settings = { ...refs.settings, liveWaitLimitMs: 40 }
      await fillLane("llm")
      const res = await post(r.url, r.body, STREAM)
      expect(sseEvents(res.body).at(-1)).toEqual({ type: "error", data: { code: "lane_busy", message: BUSY } })
      expect(m.llmStream).not.toHaveBeenCalled()
      expect(m.reserveCreditsForJob).not.toHaveBeenCalled()
      // The hold is settled once with a spend that billed nothing (refunded), the error recorded, the job failed.
      expect(m.metered.settle).toHaveBeenCalledTimes(1)
      const spend = (m.metered.settle.mock.calls[0] as unknown[])[2] as { billedAnything: boolean; attempts: unknown[] }
      expect(spend.billedAnything).toBe(false)
      expect(spend.attempts).toEqual([])
      expect(m.db.current.jobs[0]).toMatchObject({ output_data: { error: BUSY } })
      expect(m.markJobFailed).toHaveBeenCalledWith(m.db.current.jobs[0]!.id, { error_message: BUSY })
      expect(m.markJobFailed).toHaveBeenCalledTimes(1)
    })
  }
})

describe("an approval is never blocked by a busy lane", () => {
  it("at the limit the approval succeeds with its caption skipped, nothing reserved for it", async () => {
    m.metered.on = true
    seedApproval()
    await fillLane("llm")
    const withdraw = vi.spyOn(gate, "withdraw")
    const res = await post(APPROVE_URL, APPROVE)
    expect(res.statusCode).toBe(200)
    // The same answer a refused caption hold gives: approved, no description.
    expect(res.json()).toEqual({ sourceImageUrl: "https://cdn.test/c.png", canonicalDescription: "" })
    expect(m.caption).not.toHaveBeenCalled()
    expect(m.meterOptional).not.toHaveBeenCalled()
    expect(withdraw).toHaveBeenCalledTimes(1)
    expect((await laneOf("llm"))?.queued ?? 0).toBe(0)
  })

  // Under a job's run or coordinator hold (a workflow, the plugin toolkit, the
  // director or an MCP tool reaching the route in-process) the caption's slot
  // is a front-of-line slot of the job's line — still taken only if free now.
  for (const role of ["run", "coordinator"] as const) {
    it(`under a ${role} hold with the llm lane full the approval succeeds at once, its caption skipped, nothing reserved`, async () => {
      m.metered.on = true
      seedApproval()
      await fillLane("llm")
      const acquire = vi.spyOn(gate, "acquire")
      const withdraw = vi.spyOn(gate, "withdraw")
      const hold = { role, lane: null, userId: USER, payer: `user:${USER}` as const, tier: null, jobId: "job-run-1", leaseId: null }
      const started = Date.now()
      const res = await runHolding(hold, async () => await app.inject({ method: "POST", url: APPROVE_URL, headers: { "x-user": USER, "x-internal": "1" }, payload: APPROVE }))
      expect(Date.now() - started).toBeLessThan(1_000)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ sourceImageUrl: "https://cdn.test/c.png", canonicalDescription: "" })
      expect(m.caption).not.toHaveBeenCalled()
      expect(m.meterOptional).not.toHaveBeenCalled()
      // One ask, at the front of the job's line, withdrawn at once.
      expect(acquire).toHaveBeenCalledTimes(1)
      expect(acquire.mock.calls[0]![0].mode).toBe("front")
      expect(acquire.mock.calls[0]![0].meta.queue).toBe("inline")
      expect(withdraw).toHaveBeenCalledTimes(1)
      expect((await laneOf("llm"))?.queued ?? 0).toBe(0)
    })

    it(`under a ${role} hold with a free slot the caption runs under that one slot`, async () => {
      m.metered.on = true
      seedApproval()
      // The caption's own LLM call goes through the funnel: it must not take a second slot.
      m.caption.mockImplementation(async () => {
        await withConcurrencySlot({ lane: "llm", provider: "kie", jobType: "creature-caption" }, async () => {
          seen.captionHold = currentConcurrencyHold()
        })
        return { caption: "a small blue dragon", request: {}, outcome: { response: {} } }
      })
      const acquire = vi.spyOn(gate, "acquire")
      const hold = { role, lane: null, userId: USER, payer: `user:${USER}` as const, tier: null, jobId: "job-run-1", leaseId: null }
      const res = await runHolding(hold, async () => await app.inject({ method: "POST", url: APPROVE_URL, headers: { "x-user": USER, "x-internal": "1" }, payload: APPROVE }))
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ canonicalDescription: "a small blue dragon" })
      expect(acquire).toHaveBeenCalledTimes(1)
      expect(seen.captionHold).toMatchObject({ role: "leaf", lane: "llm" })
    })
  }

  it("with a free slot the caption runs under it", async () => {
    m.metered.on = true
    seedApproval()
    const acquire = vi.spyOn(gate, "acquire")
    const res = await post(APPROVE_URL, APPROVE)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sourceImageUrl: "https://cdn.test/c.png", canonicalDescription: "a small blue dragon" })
    expect(m.meterOptional).toHaveBeenCalledTimes(1)
    expect(m.caption).toHaveBeenCalledTimes(1)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0].meta).toMatchObject({ lane: "llm", jobType: "/v1/creatures/:id/approve-main-image", queue: "live" })
    expect(acquire.mock.invocationCallOrder[0]!).toBeLessThan(m.meterOptional.mock.invocationCallOrder[0]!)
  })
})

describe("a scraper in its synchronous mode", () => {
  it("the scraper's LLM analysis runs under the scraper's slot", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const res = await post("/v1/meta-ads-scrape", META_ADS)
    expect(res.statusCode).toBe(200)
    expect(m.analyze).toHaveBeenCalledTimes(1)
    // One slot for the whole run — the provider one — taken before the reservation.
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0].meta).toMatchObject({ lane: "provider", provider: "apify", jobType: "/v1/meta-ads-scrape", queue: "live" })
    expect(acquire.mock.invocationCallOrder[0]!).toBeLessThan(m.reserveCreditsForJob.mock.invocationCallOrder[0]!)
    expect(seen.analysisHold).toMatchObject({ role: "leaf", lane: "provider" })
    expect(seen.analysisCallHold).toMatchObject({ role: "leaf", lane: "provider" })
  })

  it("a job-id-first request answers at once and takes no slot", async () => {
    await fillLane("provider")
    const acquire = vi.spyOn(gate, "acquire")
    const res = await post("/v1/meta-ads-scrape", { ...META_ADS, respondAsync: true })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: "pending" })
    // No slot for the request itself (its detached work is counted on its own).
    expect(acquire.mock.calls.filter(([r]) => r.meta.jobType === "/v1/meta-ads-scrape")).toEqual([])
  })
})

describe("the voice routes", () => {
  async function validate(): Promise<void> {
    const res = await post("/v1/suno/voice/validate", { voiceUrl: "https://cdn.test/v.mp3", vocalStartS: 0, vocalEndS: 20 })
    expect(res.statusCode).toBe(200)
    await until(async () => ((await laneOf("provider"))?.running ?? 0) === 0)
  }

  it("Suno voice create waits for a provider slot", async () => {
    await validate()
    const [other] = await fillLane("provider")
    let res: Awaited<ReturnType<typeof post>> | undefined
    const p = post("/v1/suno/voice/generate", { taskId: "kie-validate-1", verifyUrl: "https://cdn.test/verify.mp3" }).then((r) => { res = r })
    await until(async () => (await laneOf("provider"))?.queued === 1)
    expect(m.reserveCreditsForJob).not.toHaveBeenCalled()
    expect(m.suno.generate).not.toHaveBeenCalled()
    await freeOne(other!)
    await p
    expect(res?.statusCode).toBe(200)
    expect(m.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(m.suno.generate).toHaveBeenCalledTimes(1)
  })

  it("Suno voice validate waits for a provider slot", async () => {
    const [other] = await fillLane("provider")
    let res: Awaited<ReturnType<typeof post>> | undefined
    const p = post("/v1/suno/voice/validate", { voiceUrl: "https://cdn.test/v.mp3", vocalStartS: 0, vocalEndS: 20 }).then((r) => { res = r })
    await until(async () => (await laneOf("provider"))?.queued === 1)
    expect(m.suno.validate).not.toHaveBeenCalled()
    await freeOne(other!)
    await p
    expect(res?.statusCode).toBe(200)
    expect(m.suno.validate).toHaveBeenCalledTimes(1)
  })

  // Voice cloning is retired platform-wide: its create routes answer 410 and
  // call no provider, so there is no work to wait for.
  it("voice clone: creation is retired, so nothing waits and nothing is called", async () => {
    await fillLane("provider")
    const acquire = vi.spyOn(gate, "acquire")
    const res = await post("/v1/voice-clones/from-url", { name: "v", audioUrl: "https://cdn.test/v.mp3" })
    expect(res.statusCode).toBe(410)
    expect(acquire).not.toHaveBeenCalled()
  })

  // Voice design runs as a `voice-design` worker job: the route answers with
  // its id at once, and the job waits for a provider slot at pickup.
  it("voice design answers at once with no live slot; its worker job waits for a provider slot at pickup", async () => {
    await fillLane("provider")
    const acquire = vi.spyOn(gate, "acquire")
    const res = await post("/v1/voice-design", VOICE_DESIGN)
    expect(res.statusCode).toBe(200)
    expect(acquire).not.toHaveBeenCalled()
    expect(m.queueAdd).toHaveBeenCalledWith("voice-design", expect.anything())
    expect(laneClassOf("video-generation", "voice-design", {})).toEqual({ kind: "leaf", lane: "provider" })
  })
})

describe("with lanes locked (the default), nothing waits and no answer changes", () => {
  let plain: FastifyInstance

  beforeEach(async () => {
    await gate.setEnforced(false)
    refs.settings = { ...refs.settings, liveWaitLimitMs: 1 }
    await fillLane("llm")
    await fillLane("provider")
    plain = await buildApp({ scoped: false })
  })

  afterEach(async () => {
    await plain.close()
  })

  /** The same request on an app without the request scope (no lanes at all), then on the real one. */
  async function both(url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}, seed = () => { m.db.current = strictJobsSupabase() }) {
    seed()
    const before = await post(url, payload, headers, plain)
    seed()
    const acquire = vi.spyOn(gate, "acquire")
    const after = await post(url, payload, headers)
    return { before, after, acquire }
  }

  type Answer = Awaited<ReturnType<typeof post>>
  /** Status, headers (but the clock's `date`) and body, with server-made ids blanked. */
  const answerOf = (r: Answer) => {
    const { date: _date, ...headers } = r.headers
    return { status: r.statusCode, headers, body: withoutIds(r.body) }
  }
  const expectSameAnswer = (after: Answer, before: Answer) => expect(answerOf(after)).toEqual(answerOf(before))

  it("an LLM JSON route", async () => {
    const { before, after, acquire } = await both("/v1/llm-chat/generate", CHAT)
    expect(after.statusCode).toBe(200)
    expectSameAnswer(after, before)
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(await laneOf("llm")).toMatchObject({ queued: 0 })
  })

  it("an LLM stream", async () => {
    const { before, after, acquire } = await both("/v1/llm-chat/generate-stream", CHAT, { accept: "text/event-stream" })
    expect(after.statusCode).toBe(200)
    expect(sseEvents(after.body).map((e) => e.type)).toEqual(["metadata", "token", "token", "done"])
    expectSameAnswer(after, before)
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it("a scraper in its synchronous mode", async () => {
    const { before, after, acquire } = await both("/v1/meta-ads-scrape", META_ADS)
    expect(after.statusCode).toBe(200)
    expectSameAnswer(after, before)
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it("a voice route", async () => {
    // Validate first, on each app's own table: the create checks the caller owns the validate task.
    const validate = { voiceUrl: "https://cdn.test/v.mp3", vocalStartS: 0, vocalEndS: 20 }
    const create = { taskId: "kie-validate-1", verifyUrl: "https://cdn.test/verify.mp3" }
    expect((await post("/v1/suno/voice/validate", validate, {}, plain)).statusCode).toBe(200)
    const before = await post("/v1/suno/voice/generate", create, {}, plain)
    m.db.current = strictJobsSupabase()
    const acquire = vi.spyOn(gate, "acquire")
    expect((await post("/v1/suno/voice/validate", validate)).statusCode).toBe(200)
    const after = await post("/v1/suno/voice/generate", create)
    expect(after.statusCode).toBe(200)
    expectSameAnswer(after, before)
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it("an approval: its caption runs as before", async () => {
    m.metered.on = true
    const { before, after, acquire } = await both(APPROVE_URL, APPROVE, {}, seedApproval)
    expect(after.statusCode).toBe(200)
    expect(after.json()).toMatchObject({ canonicalDescription: "a small blue dragon" })
    expectSameAnswer(after, before)
    expect(m.caption).toHaveBeenCalledTimes(2)
    expect(acquire).toHaveBeenCalledTimes(1)
  })
})
