// @test-units-by-name runs the podcast pack over the use-case types it names (tighten-episode, clip-pack, speaker-layout)
/**
 * POST /v1/podcast-pack (decided 2026-11-18): several podcast tools on one
 * recording, one price — every started 15 seconds of the original recording.
 * Every tool's own refusals come first (its estimate route), then the length,
 * then the pack's job and its charge, then each tool's run on the internal
 * lane, named to the pack under a server-only key and the pack's own key for
 * it. The pack completes once its tools started and keeps its charge; a pack
 * none of whose tools started fails and is refunded.
 */
import Fastify, { type FastifyInstance } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"

const USER = "00000000-0000-4000-8000-000000000001"
const PACK = "66666666-6666-4666-8666-666666666666"

const m = vi.hoisted(() => ({
  durationSec: 512 as number | null,
  masterSec: null as number | null,
  measuredWith: [] as string[],
  prepare: { ok: true } as Record<string, unknown>,
  guardBase: [] as Array<number | undefined>,
  reserved: [] as Array<{ jobId: string; id: string }>,
  reserveRefuses: false,
  inserted: [] as Array<Record<string, unknown>>,
  completed: [] as Array<[string, Record<string, unknown>]>,
  failed: [] as unknown[][],
  committed: [] as string[],
  refunded: [] as string[],
  calls: [] as Array<{ url: string; headers: Record<string, unknown>; body: Record<string, unknown> }>,
  answers: {} as Record<string, { status: number; body: unknown }>,
  authKind: "jwt" as "jwt" | "internal",
  outcome: "completed" as "completed" | "held" | "blocked" | "lost_race",
  cancelled: [] as string[],
  // The pack's job as later reads find it (POST /v1/podcast-pack/:id/start), and what they wrote over it.
  packRow: null as Record<string, unknown> | null,
  packRuns: [] as Array<{ id: string }>,
  packUpdates: [] as Array<Record<string, unknown>>,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const k of ["select", "eq"]) chain[k] = () => chain
      chain.maybeSingle = async () => ({ data: m.packRow, error: null })
      chain.limit = async () => ({ data: m.packRuns, error: null })
      chain.update = (row: Record<string, unknown>) => {
        m.packUpdates.push(row)
        const done = { eq: () => done, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }
        return done
      }
      return chain
    },
  },
}))
vi.mock("@/lib/cancel-job.js", () => ({ cancelOwnedJob: async (id: string) => (m.cancelled.push(id), { kind: "cancelled" }) }))

vi.mock("@/lib/config.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/config.js")>()),
  hasCredits: () => true,
  config: { ...(await orig<typeof import("@/lib/config.js")>()).config, INTERNAL_ORCHESTRATOR_SECRET: "test-secret" },
}))
vi.mock("@/lib/use-case/request.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/use-case/request.js")>()),
  prepareUseCase: async (type: string) => {
    m.measuredWith.push(type)
    return {
      sources: { media: { durationSec: m.durationSec ?? undefined }, ...(m.masterSec !== null ? { masterAudio: { durationSec: m.masterSec } } : {}) },
      ...m.prepare,
    }
  },
}))
vi.mock("@/lib/credit-base-cost.js", () => ({ unitRateBaseCredits: async (_id: string, units: number) => units * 20 }))
vi.mock("@/lib/pricing/charged-prices.js", () => ({ loadChargedPrices: async () => ({ credits: (_id: string, units: number) => units * 22 }) }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (_model: unknown, opts?: { computeCredits?: (b: unknown, r: unknown) => Promise<number | undefined> }) => async (req: { body: unknown }) => {
    m.guardBase.push(await opts?.computeCredits?.(req.body, req))
  },
  reserveCreditsForJob: async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }, jobId: string, id: string) => {
    m.reserved.push({ jobId, id })
    if (m.reserveRefuses) reply.status(402).send({ error: { code: "insufficient_credits", message: "Insufficient credits" } })
  },
}))
vi.mock("@/lib/insert-job.js", () => ({
  insertSyncJob: async (_req: unknown, row: Record<string, unknown>) => {
    m.inserted.push(row)
    return { data: { id: PACK }, error: null }
  },
  insertSyncJobIdempotent: async () => ({ created: true, row: { id: PACK } }),
}))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailed: async (...a: unknown[]) => (m.failed.push(a), true) }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: async (id: string) => void m.committed.push(id),
  refundReservedCreditsForJob: async (id: string) => (m.refunded.push(id), 1),
}))
vi.mock("@/workers/shared.js", () => ({
  markJobCompletedDetailed: async (id: string, fields: Record<string, unknown>) => (m.completed.push([id, fields]), m.outcome),
}))

const { podcastPackRoutes } = await import("../podcast-pack.js")
const { podcastPackUnits } = await import("../../lib/use-case/pack-price.js")

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    // The pack route's own caller; the tools' routes it reaches are always internal.
    req.authKind = req.url.startsWith("/v1/podcast-pack") ? m.authKind : "internal"
  })
  // The tools' own routes, as the pack reaches them: recorded and answered as a test sets.
  for (const route of ["/v1/tighten-episode", "/v1/clip-pack", "/v1/speaker-layout", "/v1/episode-chapters"]) {
    for (const url of [route, `${route}/estimate`]) {
      app.post(url, async (req, reply) => {
        m.calls.push({ url, headers: req.headers as Record<string, unknown>, body: req.body as Record<string, unknown> })
        const answer = m.answers[url] ?? (url.endsWith("/estimate") ? { status: 200, body: { data: {} } } : { status: 202, body: { jobId: `job-${route.slice(4)}`, executionId: `exec-${route.slice(4)}` } })
        return reply.status(answer.status).send(answer.body)
      })
    }
  }
  await app.register(podcastPackRoutes)
  await app.ready()
  return app
}

const BODY = {
  mediaUrls: ["https://r2/ep.mp4"],
  speakerNames: { speaker_0: "Dana" },
  tools: { "tighten-episode": { planTier: "standard" }, "clip-pack": { count: 5, mediaUrls: ["https://evil/x.mp4"], __coveredBy: "forged" } },
}
const post = async (body: Record<string, unknown> = BODY, url = "/v1/podcast-pack") => (await makeApp()).inject({ method: "POST", url, payload: body })
const runCalls = () => m.calls.filter((c) => !c.url.endsWith("/estimate"))

beforeEach(() => {
  Object.assign(m, {
    durationSec: 512, masterSec: null, measuredWith: [], prepare: { ok: true }, guardBase: [], reserved: [], reserveRefuses: false, inserted: [], completed: [], failed: [],
    committed: [], refunded: [], calls: [], answers: {}, authKind: "jwt", outcome: "completed", cancelled: [],
    packRow: null, packRuns: [], packUpdates: [],
  })
})

describe("POST /v1/podcast-pack", () => {
  it("charges every started 15 seconds once, then starts each tool covered by the pack", async () => {
    const res = await post()
    expect(res.statusCode, res.body).toBe(202)
    // 8:32 = 512 s = 35 started units; the guard is handed the base of 35 units.
    expect(m.guardBase).toEqual([700])
    expect(m.inserted[0]).toMatchObject({ provider: "podcast-pack", job_type: "podcast-pack", status: "processing" })
    expect(m.inserted[0]!.input_data).toMatchObject({ tools: ["tighten-episode", "clip-pack"], durationSec: 512, units: 35 })
    expect(m.reserved).toEqual([{ jobId: PACK, id: "podcast-pack:per-15s" }])
    // Every tool's estimate ran before anything was written.
    expect(m.calls.slice(0, 2).map((c) => c.url)).toEqual(["/v1/tighten-episode/estimate", "/v1/clip-pack/estimate"])
    for (const call of runCalls()) {
      const type = call.url.slice(4)
      expect(call.headers["x-internal-orchestrator-secret"]).toBe("test-secret")
      expect(call.headers["idempotency-key"]).toBe(`uc-pack-${PACK}-${type}`)
      expect(call.body).toMatchObject({ userId: USER, __coveredBy: PACK, mediaUrls: ["https://r2/ep.mp4"] })
    }
    expect(m.completed).toHaveLength(1)
    expect(m.committed).toEqual([PACK])
    expect(res.json()).toMatchObject({
      jobId: PACK, units: 35, durationSec: 512,
      tools: [{ tool: "tighten-episode", jobId: "job-tighten-episode" }, { tool: "clip-pack", jobId: "job-clip-pack" }],
    })
  })

  it("each tool's own settings, the pack's recording, and the speakers' names only where the tool takes them", async () => {
    await post()
    const [tighten, clips] = runCalls()
    expect(tighten!.body).toMatchObject({ planTier: "standard", speakerNames: { speaker_0: "Dana" } })
    // A tool's settings never carry the recording or a server key of their own.
    expect(clips!.body).toMatchObject({ count: 5, mediaUrls: ["https://r2/ep.mp4"], __coveredBy: PACK })
    expect(clips!.body).not.toHaveProperty("speakerNames")
  })

  it("a tool's own refusal refuses the pack before anything is written or charged", async () => {
    m.answers["/v1/clip-pack/estimate"] = { status: 403, body: { error: { code: "node_not_available", message: "Not available" } } }
    const res = await post()
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatchObject({ code: "node_not_available", tool: "clip-pack" })
    expect(m.inserted).toEqual([])
    expect(m.reserved).toEqual([])
  })

  it("a recording whose length cannot be read is refused before anything is written", async () => {
    m.durationSec = null
    const res = await post()
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("media_unreadable")
    expect(m.inserted).toEqual([])
  })

  it("priced on the longest clock a chosen tool runs on: a Master audio longer than the recording", async () => {
    m.durationSec = 15
    m.masterSec = 7200
    // Chapters takes no Master audio; Clip Pack does, so the pack is measured through it.
    const res = await post({ mediaUrls: ["https://r2/ep.mp4"], masterAudioUrl: "https://r2/master.mp3", tools: { "episode-chapters": {}, "clip-pack": {} } }, "/v1/podcast-pack/estimate")
    expect(m.measuredWith).toEqual(["clip-pack"])
    expect(res.json().data).toMatchObject({ durationSec: 7200, units: 480 })
  })

  it("the charge is final once the first tool started, before the others start", async () => {
    m.answers["/v1/clip-pack"] = { status: 409, body: { error: { code: "busy", message: "Busy" } } }
    await post()
    expect(m.committed).toEqual([PACK])
  })

  it("a held price refused: the pack fails, no tool starts", async () => {
    m.reserveRefuses = true
    const res = await post()
    expect(res.statusCode).toBe(402)
    expect(m.failed).toHaveLength(1)
    expect(runCalls()).toEqual([])
  })

  it("some tools started: the pack completes and keeps its charge, naming the one that did not", async () => {
    m.answers["/v1/clip-pack"] = { status: 409, body: { error: { code: "busy", message: "Busy" } } }
    const res = await post()
    expect(res.statusCode).toBe(202)
    expect(res.json().notStarted).toEqual([{ tool: "clip-pack", error: expect.objectContaining({ code: "busy", tool: "clip-pack" }) }])
    expect(m.committed).toEqual([PACK])
    expect(m.refunded).toEqual([])
  })

  it("no tool started: the pack fails and its charge is returned", async () => {
    m.answers["/v1/tighten-episode"] = { status: 409, body: { error: { code: "busy", message: "Busy" } } }
    m.answers["/v1/clip-pack"] = { status: 409, body: { error: { code: "busy", message: "Busy" } } }
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(m.failed).toHaveLength(1)
    expect(m.refunded).toEqual([PACK])
    expect(m.committed).toEqual([])
  })

  it("refuses a body with no tool, or a tool that is not a podcast tool", async () => {
    for (const tools of [{}, { "generate-image": {} }]) {
      const res = await post({ mediaUrls: ["https://r2/ep.mp4"], tools })
      expect(res.statusCode, JSON.stringify(tools)).toBe(400)
    }
    expect(m.calls).toEqual([])
  })
})

describe("a pack held for review", () => {
  it("everything stops: the tools it started are stopped, and the pack answers that it is under review", async () => {
    m.outcome = "held"
    const res = await post()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("pack_under_review")
    expect(m.cancelled).toEqual(["job-tighten-episode", "job-clip-pack"])
  })

  it("a blocked pack stops its tools the same way", async () => {
    m.outcome = "blocked"
    expect((await post()).statusCode).toBe(409)
    expect(m.cancelled).toHaveLength(2)
  })
})

describe("POST /v1/podcast-pack/:id/start — a tool that did not start, started later", () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    provider: "podcast-pack", status: "completed", workflow_id: null, node_id: null,
    input_data: { tools: ["tighten-episode", "clip-pack"], settings: { "tighten-episode": {}, "clip-pack": { count: 5 } }, mediaUrls: ["https://r2/ep.mp4"], speakerNames: { speaker_0: "Dana" }, units: 35 },
    output_data: { tools: [{ tool: "tighten-episode", jobId: "job-a", executionId: null }], notStarted: [{ tool: "clip-pack", error: { code: "busy" } }] },
    ...over,
  })
  const start = async (tool: string) => (await makeApp()).inject({ method: "POST", url: `/v1/podcast-pack/${PACK}/start`, payload: { tool } })

  it("starts it free, under the pack's own key for it, with the pack's recording and its own settings", async () => {
    m.packRow = stored()
    const res = await start("clip-pack")
    expect(res.statusCode, res.body).toBe(202)
    expect(res.json()).toMatchObject({ jobId: "job-clip-pack", tool: "clip-pack" })
    const [call] = runCalls()
    expect(call!.headers["idempotency-key"]).toBe(`uc-pack-${PACK}-clip-pack`)
    expect(call!.body).toMatchObject({ __coveredBy: PACK, count: 5, mediaUrls: ["https://r2/ep.mp4"] })
    // The pack's list of runs gains it, and it leaves the list of tools that did not start.
    expect(m.packUpdates.at(-1)!.output_data).toEqual({ tools: [{ tool: "tighten-episode", jobId: "job-a", executionId: null }, { tool: "clip-pack", jobId: "job-clip-pack", executionId: "exec-clip-pack" }] })
    expect(m.inserted).toEqual([])
    expect(m.reserved).toEqual([])
  })

  it("a pack held for review: refused, nothing started", async () => {
    m.packRow = stored({ status: "pending_review" })
    const res = await start("clip-pack")
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("pack_under_review")
    expect(runCalls()).toEqual([])
  })

  it("a pack still starting its tools, one not the user's, or a tool it did not pay for: refused", async () => {
    m.packRow = stored({ status: "processing" })
    expect((await start("clip-pack")).statusCode).toBe(409)
    m.packRow = stored({ status: "failed" })
    expect((await start("clip-pack")).statusCode).toBe(404)
    m.packRow = stored()
    expect((await start("speaker-layout")).statusCode).toBe(404)
    m.packRow = null
    expect((await start("clip-pack")).statusCode).toBe(404)
    expect(runCalls()).toEqual([])
  })
})

describe("a tool that stops for a review", () => {
  const reviewing = { mediaUrls: ["https://r2/ep.mp4"], tools: { "clip-pack": { reviewBeforeRender: true }, "tighten-episode": {} } }

  it("a caller from outside the server can review: each tool is started with a reviewer", async () => {
    const res = await post(reviewing)
    expect(res.statusCode).toBe(202)
    for (const call of runCalls()) expect(call.body.reviewerPresent).toBe(true)
  })

  it("inside a run nobody can review: refused before anything is written or charged", async () => {
    m.authKind = "internal"
    const res = await post(reviewing)
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "preview_review_required", tool: "clip-pack" })
    expect(m.inserted).toEqual([])
    expect(m.reserved).toEqual([])
  })

  it("inside a run that says a person is there: started with a reviewer", async () => {
    m.authKind = "internal"
    const res = await post({ ...reviewing, reviewerPresent: true })
    expect(res.statusCode).toBe(202)
    for (const call of runCalls()) expect(call.body.reviewerPresent).toBe(true)
  })
})

describe("POST /v1/podcast-pack/estimate", () => {
  it("the same refusals and the price, nothing written or charged", async () => {
    const res = await post(BODY, "/v1/podcast-pack/estimate")
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ tools: ["tighten-episode", "clip-pack"], durationSec: 512, units: 35, credits: 770 })
    expect(m.inserted).toEqual([])
    expect(m.reserved).toEqual([])
    expect(runCalls()).toEqual([])
  })
})

describe("podcastPackUnits", () => {
  it("every started 15 seconds, at least one", () => {
    expect(podcastPackUnits(512)).toBe(35)
    expect(podcastPackUnits(15)).toBe(1)
    expect(podcastPackUnits(15.0000001)).toBe(1)
    expect(podcastPackUnits(15.5)).toBe(2)
    expect(podcastPackUnits(0.2)).toBe(1)
    expect(() => podcastPackUnits(0)).toThrow()
    expect(() => podcastPackUnits(Number.NaN)).toThrow()
  })
})
