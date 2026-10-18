import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ quote: vi.fn(), estimate: vi.fn(), hold: vi.fn(), verify: vi.fn(), services: {} as Record<string, unknown> }))
// The check of every claimed clip against the caller's own jobs (ugc-clip-reuse-check.test.ts covers it).
vi.mock("../../lib/ugc-clip-reuse-check.js", () => ({ verifiedReusedClips: h.verify }))
vi.mock("../../lib/ugc-estimate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ugc-estimate.js")>()),
  quoteUgcTickets: h.quote,
  estimateUgcRun: h.estimate,
  ugcRenderHold: h.hold,
}))
// The private plugins' services: what the plugin hands the app (its plan schema's line limits, here).
vi.mock("../../../lib/private-plugins/load.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/private-plugins/load.js")>()),
  getPluginServices: () => h.services,
}))
// The leaf the consumers read the services from (load.js re-exports it): the same
// stand-in. Not a forward to the load.js mock — that one loads the real load.ts,
// which imports this leaf, and the two factories would wait on each other.
vi.mock("../../../lib/private-plugins/services-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/private-plugins/services-registry.js")>()),
  getPluginServices: () => h.services,
}))

import { UgcEstimateUnavailable } from "../../lib/ugc-estimate.js"
import { UgcQuoteError } from "../../lib/ugc-quote.js"
import { ugcQuoteRoutes } from "../ugc-quote.js"

const result = { lines: [{ label: "Clip 1 (12 s)", credits: 100 }], expected: 100, ceiling: 200 }
const ticket = { v: 1, index: 0, durationSec: 12, video: { tool: "generate_video", args: {} }, speech: null }
const good = { estimate: { targetDurationSec: 15, screenshotCount: 3, source: "sampled" } }
const NOT_SERVED = "UGC videos are a Nodaro Cloud feature and are not served on this deployment."

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  h.services = {}
  app = Fastify({ logger: false })
  // Bypass auth: the user comes from a header, as the other ee route tests do.
  app.addHook("preHandler", async (req) => {
    const id = req.headers["x-test-user-id"]
    if (typeof id === "string") req.userId = id
  })
  await app.register(ugcQuoteRoutes)
  await app.ready()
})
afterEach(async () => { await app.close() })

const post = (payload: unknown, user: string | null = "u1") =>
  app.inject({ method: "POST", url: "/v1/ugc/quote", payload: payload as object, headers: user ? { "x-test-user-id": user } : {} })

describe("POST /v1/ugc/quote", () => {
  it("401 without a user", async () => {
    const res = await post({ tickets: [ticket], hasCards: true }, null)
    expect(res.statusCode).toBe(401)
    expect(h.quote).not.toHaveBeenCalled()
  })
  it("400 for an empty ticket list, a too-short estimate and an unknown shape", async () => {
    expect((await post({ tickets: [], hasCards: true })).statusCode).toBe(400)
    expect((await post({ estimate: { ...good.estimate, targetDurationSec: 3 } })).statusCode).toBe(400)
    expect((await post({ tickets: [ticket] })).statusCode).toBe(400)
    expect((await post({ tickets: [ticket], hasCards: true, extra: 1 })).statusCode).toBe(400)
    expect(h.quote).not.toHaveBeenCalled()
    expect(h.estimate).not.toHaveBeenCalled()
  })
  it("200 with the ticket quote, priced for the signed-in user", async () => {
    h.quote.mockResolvedValue(result)
    const res = await post({ tickets: [ticket], hasCards: false })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(result)
    expect(h.quote).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), [ticket], false, false)
  })
  it("a run whose clips go through UGC Finish's job says so (`finishes`), and the quote prices it; a non-boolean is a 400", async () => {
    h.quote.mockResolvedValue(result)
    expect((await post({ tickets: [ticket], hasCards: true, finishes: true })).statusCode).toBe(200)
    expect(h.quote).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "u1" }), [ticket], true, true)
    expect((await post({ tickets: [ticket], hasCards: true, finishes: "yes" })).statusCode).toBe(400)
  })
  it("reusedClips: each claim is checked against the caller's own jobs, and only the clips that hold are priced at nothing", async () => {
    h.quote.mockResolvedValue(result)
    h.verify.mockResolvedValue(new Set([2]))
    const tickets = [ticket, { ...ticket, index: 1 }]
    const claims = [
      { clip: 1, jobId: "00000000-0000-4000-8000-000000000001", nonce: 0 },
      { clip: 2, jobId: "00000000-0000-4000-8000-000000000002", nonce: 1 },
    ]
    expect((await post({ tickets, hasCards: false, reusedClips: claims })).statusCode).toBe(200)
    expect(h.verify).toHaveBeenLastCalledWith("u1", tickets, claims)
    // Clip 1 did not hold: it is priced in full.
    expect(h.quote).toHaveBeenLastCalledWith(expect.objectContaining({ userId: "u1" }), tickets, false, false, new Set([2]))
  })
  it("reusedClips that do not read: a 400, nothing checked or priced", async () => {
    const tickets = [ticket, { ...ticket, index: 1 }]
    const job = "00000000-0000-4000-8000-000000000001"
    for (const bad of [
      [2],
      [{ clip: 3, jobId: job, nonce: 0 }],
      [{ clip: 0, jobId: job, nonce: 0 }],
      [{ clip: 1, jobId: "iter-run-0", nonce: 0 }],
      [{ clip: 1, jobId: job, nonce: -1 }],
      [{ clip: 1, jobId: job }],
      [{ clip: 1, jobId: job, nonce: 0, extra: true }],
      [{ clip: 1, jobId: job, nonce: 0 }, { clip: 1, jobId: job, nonce: 0 }],
    ]) {
      expect((await post({ tickets, hasCards: false, reusedClips: bad })).statusCode).toBe(400)
    }
    expect(h.verify).not.toHaveBeenCalled()
    expect(h.quote).not.toHaveBeenCalled()
  })
  it("runEstimate (the hold check before a run renders the clips of a video cut from one recorded speech): the quote also answers runHold, for the same clips", async () => {
    h.quote.mockResolvedValue(result)
    h.hold.mockResolvedValue(4660)
    const runEstimate = { targetDurationSec: 15, screenshotCount: 3, source: "sampled", language: "he" }
    const res = await post({ tickets: [ticket], hasCards: true, finishes: true, runEstimate })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ...result, runHold: 4660 })
    expect(h.hold).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), runEstimate, true, true)
    // Without it, no bound is asked and the answer is the quote as it was.
    h.hold.mockClear()
    expect((await post({ tickets: [ticket], hasCards: true })).json()).toEqual(result)
    expect(h.hold).not.toHaveBeenCalled()
  })
  it("400 for a runEstimate that is not an estimate input (an unknown key, a creator-options flag, a bad language)", async () => {
    const runEstimate = { targetDurationSec: 15, screenshotCount: 3, source: "sampled", language: "he" }
    for (const bad of [{ ...runEstimate, extra: 1 }, { ...runEstimate, rendersEveryCandidate: true }, { ...runEstimate, language: "xx" }, { ...runEstimate, targetDurationSec: 2 }]) {
      expect((await post({ tickets: [ticket], hasCards: true, runEstimate: bad })).statusCode, JSON.stringify(bad)).toBe(400)
    }
    expect(h.hold).not.toHaveBeenCalled()
  })
  it("200 with the dry-run estimate", async () => {
    const est = { ...result, range: [90, 110], worstCase: 220 }
    h.estimate.mockResolvedValue(est)
    const res = await post(good)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(est)
    expect(h.estimate).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), good.estimate, { rendersEveryCandidate: false })
  })
  it("rendersEveryCandidate: the estimate prices every creator option, and the plugin's input never carries the field", async () => {
    h.estimate.mockResolvedValue({ ...result, range: [90, 110], worstCase: 220 })
    const res = await post({ estimate: { ...good.estimate, rendersEveryCandidate: true } })
    expect(res.statusCode).toBe(200)
    expect(h.estimate).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), good.estimate, { rendersEveryCandidate: true })
    expect(h.estimate.mock.calls[0]![1]).not.toHaveProperty("rendersEveryCandidate")
  })
  it("rendersEveryCandidate false is the primary alone, as when it is left out", async () => {
    h.estimate.mockResolvedValue({ ...result, range: [90, 110], worstCase: 220 })
    expect((await post({ estimate: { ...good.estimate, rendersEveryCandidate: false } })).statusCode).toBe(200)
    expect(h.estimate).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), good.estimate, { rendersEveryCandidate: false })
  })
  it("400 for a rendersEveryCandidate that is not a boolean, and on the ticket form", async () => {
    expect((await post({ estimate: { ...good.estimate, rendersEveryCandidate: "yes" } })).statusCode).toBe(400)
    expect((await post({ tickets: [ticket], hasCards: true, rendersEveryCandidate: true })).statusCode).toBe(400)
    expect(h.estimate).not.toHaveBeenCalled()
    expect(h.quote).not.toHaveBeenCalled()
  })
  it("503 not_available when the estimate cannot be served", async () => {
    h.estimate.mockRejectedValue(new UgcEstimateUnavailable())
    const res = await post(good)
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: { code: "not_available", message: NOT_SERVED } })
  })
  it("422 unpriceable on a quote error", async () => {
    h.quote.mockRejectedValue(new UgcQuoteError("Clip 1"))
    const res = await post({ tickets: [ticket], hasCards: true })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: "unpriceable", message: "could not price Clip 1" } })
  })
})

describe("the plan's line limits on the estimate's answer", () => {
  // Placeholders: whatever the plugin's own schema says, the app holds no copy of them.
  const LIMITS = { hook: 12, beatLine: 20, closerLine: 16 }
  const est = { ...result, range: [90, 110], worstCase: 220 }

  it("the estimate carries the limits the plugin hands the app", async () => {
    h.estimate.mockResolvedValue(est)
    h.services = { ugc: { estimate: vi.fn(), planLineLimits: () => LIMITS } }
    const res = await post(good)
    expect(res.json()).toEqual({ ...est, limits: LIMITS })
  })
  it("an older plugin with none: no limits, and the answer is as before", async () => {
    h.estimate.mockResolvedValue(est)
    h.services = { ugc: { estimate: vi.fn() } }
    expect((await post(good)).json()).toEqual(est)
  })
  it("limits that are not three whole numbers of characters are left out", async () => {
    h.estimate.mockResolvedValue(est)
    for (const bad of [{ ...LIMITS, hook: 0 }, { ...LIMITS, beatLine: 2.5 }, { hook: 12, beatLine: 20 }, null]) {
      h.services = { ugc: { estimate: vi.fn(), planLineLimits: () => bad } }
      expect((await post(good)).json(), JSON.stringify(bad)).toEqual(est)
    }
  })
  it("a plugin whose limits throw still answers the estimate", async () => {
    h.estimate.mockResolvedValue(est)
    h.services = { ugc: { estimate: vi.fn(), planLineLimits: () => { throw new Error("schema") } } }
    const res = await post(good)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(est)
  })
  it("the ticket quote carries none", async () => {
    h.quote.mockResolvedValue(result)
    h.services = { ugc: { estimate: vi.fn(), planLineLimits: () => LIMITS } }
    expect((await post({ tickets: [ticket], hasCards: false })).json()).toEqual(result)
  })
})
