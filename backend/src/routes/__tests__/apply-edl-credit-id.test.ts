/**
 * POST /v1/apply-edl prices a render on the id of its QUALITY — a proxy
 * (preview) on `apply-edl:proxy`, a final on `apply-edl`, for a video and an
 * audio output alike — at all three points the route touches credits: the
 * guard's resolver (the id the markup is applied at), the per-minute rate
 * `computeCredits` reads, and the reservation. The job is `apply-edl` either way.
 *
 * The rates below are SENTINELS, not prices: what is under test is which row
 * each point reads, so a preview priced on the final's row (or the other way
 * round) shows up as the other sentinel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  rate: { "apply-edl": 1000, "apply-edl:proxy": 7 } as Record<string, number>,
  resolved: [] as string[],
  computed: [] as number[],
  rateIds: [] as string[],
  reserveIds: [] as string[],
  insertJob: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: async (id: string) => {
    m.rateIds.push(id)
    return { creditCost: m.rate[id], isEnabled: true, tierRestriction: null }
  },
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard:
    (
      resolver: (req: FastifyRequest) => string,
      opts?: { computeCredits?: (body: unknown, req: FastifyRequest) => number | Promise<number> },
    ) =>
    async (req: FastifyRequest) => {
      m.resolved.push(resolver(req))
      if (opts?.computeCredits) m.computed.push(await opts.computeCredits(req.body, req))
    },
  reserveCreditsForJob: async (_req: unknown, _reply: unknown, _jobId: string, id: string) => {
    m.reserveIds.push(id)
    return { usageLogId: "ul-1", creditsReserved: 1, watermark: false }
  },
}))

import { applyEdlRoutes } from "../apply-edl.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"

/** 3 min 10 s of output → 4 billed minutes. */
const OUTPUT_MS = 190_000
const videoEdl = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://media.test/episode.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: OUTPUT_MS, video: "A", audio: "A" }],
}
const audioEdl = {
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://media.test/episode.m4a", kind: "audio" }],
  segments: [{ id: "s0", inMs: 0, outMs: OUTPUT_MS, audio: "A" }],
}

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(applyEdlRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  m.resolved = []
  m.computed = []
  m.rateIds = []
  m.reserveIds = []
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})

describe("POST /v1/apply-edl — the credit id follows the render's quality", () => {
  it.each([
    { name: "a video proxy", payload: { edl: videoEdl, quality: "proxy" }, id: "apply-edl:proxy", base: 7 * 4 },
    { name: "an audio proxy (one id per quality, both outputs)", payload: { edl: audioEdl, output: "audio", quality: "proxy" }, id: "apply-edl:proxy", base: 7 * 4 },
    { name: "a video final", payload: { edl: videoEdl, quality: "final" }, id: "apply-edl", base: 1000 * 4 },
    { name: "an audio final", payload: { edl: audioEdl, output: "audio", quality: "final" }, id: "apply-edl", base: 1000 * 4 },
    { name: "no quality (the final, by default)", payload: { edl: videoEdl }, id: "apply-edl", base: 1000 * 4 },
  ])("$name → guard, rate and reservation all on $id", async ({ payload, id, base }) => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: "/v1/apply-edl", payload })
    expect(res.statusCode).toBe(200)
    expect(m.resolved).toEqual([id])
    expect(m.rateIds).toEqual([id])
    expect(m.computed).toEqual([base])
    expect(m.reserveIds).toEqual([id])
    // The job keeps its one name; only the price row moves.
    expect(m.queueAdd).toHaveBeenCalledWith("apply-edl", expect.objectContaining({ jobId: "job-1" }))
  })
})
