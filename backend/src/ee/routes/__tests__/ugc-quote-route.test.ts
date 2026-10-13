import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ quote: vi.fn(), estimate: vi.fn(), services: {} as Record<string, unknown> }))
vi.mock("../../lib/ugc-estimate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ugc-estimate.js")>()),
  quoteUgcTickets: h.quote,
  estimateUgcRun: h.estimate,
}))
// The private plugins' services: what the plugin hands the app (its plan schema's line limits, here).
vi.mock("../../../lib/private-plugins/load.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/private-plugins/load.js")>()),
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
