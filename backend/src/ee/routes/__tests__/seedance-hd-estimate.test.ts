import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import {
  SEEDANCE_DRAFT_FINALIZE_MAX_SEC,
  SEEDANCE_DRAFT_FINALIZE_MIN_SEC,
  SEEDANCE_DRAFT_MODELS,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
} from "@nodaro/shared"

/**
 * POST /v1/credits/seedance-hd-estimate — the price of finalizing a Seedance
 * 2.5 draft at 1080p, read without creating a job or reserving anything.
 *
 * Named draft → the exact price its reservation will hold (the resolver's
 * plan, priced through `seedanceDraftFinalizeChargedCredits`); a refusal is
 * the resolver's own coded 4xx, never a 500. No draft named → the lowest price
 * ANY draft can finalize for ("from N").
 */

const resolver = vi.hoisted(() => ({
  result: { ok: true } as Record<string, unknown>,
  calls: [] as Array<Record<string, unknown>>,
  throws: false,
}))
vi.mock("../../../lib/seedance-draft-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/seedance-draft-finalize.js")>()),
  resolveSeedanceDraftFinalize: async (args: Record<string, unknown>) => {
    resolver.calls.push(args)
    if (resolver.throws) throw new Error("draft lookup failed: connection reset")
    return resolver.result
  },
}))
// No model_pricing rows: every id prices from STATIC_CREDIT_COSTS.
vi.mock("../../../lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "order", "range", "limit"]) chain[m] = () => chain
  chain.single = async () => ({ data: null, error: { code: "PGRST116", message: "no rows" } })
  return { supabase: { from: () => chain } }
})
vi.mock("../../../lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 0 }) }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
}))

import { registerSeedanceHdEstimate } from "../seedance-hd-estimate.js"
import { STATIC_CREDIT_COSTS } from "../../billing/credits.js"
import { seedanceDraftFinalizeRefBaseCredits } from "../../billing/seedance2-ref-video-credits.js"

const URL_ = "/v1/credits/seedance-hd-estimate"
const PLAN = {
  ok: true,
  sourceJobId: "11111111-2222-4333-8444-555555555555",
  draftTaskId: "task-draft",
  outputSec: 4,
  hasRefVideo: false,
  refVideoDurationsSec: [],
  creditId: "seedance-2-5-hd:4s",
}

describe("POST /v1/credits/seedance-hd-estimate", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    resolver.calls = []
    resolver.result = PLAN
    resolver.throws = false
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const user = req.headers["x-test-user"]
      if (typeof user === "string") req.userId = user
    })
    registerSeedanceHdEstimate(app)
    await app.ready()
  })
  afterEach(async () => { await app.close() })

  const post = (payload: Record<string, unknown>, user: string | null = "user-a") =>
    app.inject({ method: "POST", url: URL_, payload, headers: user ? { "x-test-user": user } : {} })

  it("needs a signed-in caller", async () => {
    const res = await post({ taskId: "task-draft" }, null)
    expect(res.statusCode).toBe(401)
    expect(resolver.calls).toEqual([])
  })

  it("rejects a malformed body before resolving anything", async () => {
    const res = await post({ taskId: 42 })
    expect(res.statusCode).toBe(400)
    expect(resolver.calls).toEqual([])
  })

  it("prices a named no-reference draft at its own row (4 s → 1580)", async () => {
    const res = await post({ taskId: "task-draft" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { credits: 1580, minimum: false } })
    expect(resolver.calls).toEqual([{ userId: "user-a", taskId: "task-draft", sourceJobId: undefined }])
  })

  it("prices a named reference-video draft on input + output seconds (4 s in + 4 s out → 1900)", async () => {
    resolver.result = { ...PLAN, hasRefVideo: true, refVideoDurationsSec: [4.04], creditId: "seedance-2-5-hd:4s-ref" }
    const res = await post({ sourceJobId: PLAN.sourceJobId })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { credits: 1900, minimum: false } })
    expect(resolver.calls[0]).toMatchObject({ sourceJobId: PLAN.sourceJobId })
  })

  it.each([
    [403, "forbidden", "You do not own the referenced draft."],
    [404, "draft_not_found", "No Seedance draft was found for that id."],
    [409, "draft_not_ready", "That draft has not finished successfully, so there is nothing to finalize yet."],
    [422, "not_a_draft", "That Seedance 2.5 video was not made as a draft."],
  ])("a %i refusal from the resolver is returned as is", async (status, code, message) => {
    resolver.result = { ok: false, status, code, message }
    const res = await post({ taskId: "task-draft" })
    expect(res.statusCode).toBe(status)
    expect(res.json()).toEqual({ error: { code, message } })
  })

  it("a resolver failure is a sanitized 500, never a raw message", async () => {
    resolver.throws = true
    const res = await post({ taskId: "task-draft" })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(res.body).not.toContain("connection reset")
  })

  it("with no draft named, answers the lowest price any draft can finalize for — without resolving", async () => {
    const res = await post({})
    expect(res.statusCode).toBe(200)
    expect(resolver.calls).toEqual([])

    // The candidates, priced by the same functions the reservation uses: every
    // no-reference length, and every length with the SHORTEST reference clip
    // the draft model accepts (its declared per-clip minimum).
    const minRefSec = VIDEO_REF_VIDEO_DURATION_LIMITS[SEEDANCE_DRAFT_MODELS[0]]!.minSec
    const candidates: number[] = []
    for (let n = SEEDANCE_DRAFT_FINALIZE_MIN_SEC; n <= SEEDANCE_DRAFT_FINALIZE_MAX_SEC; n++) {
      candidates.push(STATIC_CREDIT_COSTS[`seedance-2-5-hd:${n}s`]!)
      candidates.push(seedanceDraftFinalizeRefBaseCredits({ outputSec: n, refVideoDurationsSec: [minRefSec] }))
    }
    expect(res.json()).toEqual({ data: { credits: Math.min(...candidates), minimum: true } })
  })

  it("the floor is a 2 s reference clip finalized into a 4 s draft: ceil(237.5 × (2 + 4)) = 1425, below the 4 s no-reference 1580", async () => {
    const res = await post({})
    expect(res.json().data.credits).toBe(1425)
    expect(res.json().data.credits).toBeLessThan(STATIC_CREDIT_COSTS["seedance-2-5-hd:4s"]!)
  })
})
