import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ quote: vi.fn(), estimate: vi.fn() }))
vi.mock("../../lib/ugc-estimate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/ugc-estimate.js")>()),
  quoteUgcTickets: h.quote,
  estimateUgcRun: h.estimate,
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
    expect(h.quote).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), [ticket], false)
  })
  it("200 with the dry-run estimate", async () => {
    const est = { ...result, range: [90, 110], worstCase: 220 }
    h.estimate.mockResolvedValue(est)
    const res = await post(good)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(est)
    expect(h.estimate).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), good.estimate)
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
