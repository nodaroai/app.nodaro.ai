import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /v1/use-case-fee: a use-case node's per-run fee, charged to a client
 * that builds the node's result in its own editor. It is held at the fee's own
 * price id, settled on a job row of its own, and given back when the row
 * cannot be completed.
 */
const state = vi.hoisted(() => ({
  userId: "user-1" as string | undefined,
  guarded: [] as string[],
  noCredits: false,
  completes: true,
  insertFails: false,
}))

vi.mock("../../../middleware/credit-guard.js", () => ({
  creditGuard: (creditId: (req: { body: unknown }) => string) => async (req: { body: unknown }) => {
    state.guarded.push(creditId(req))
  },
  reserveCreditsForJob: vi.fn(async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => void } }) => {
    if (state.noCredits) reply.status(402).send({ error: { code: "insufficient_credits", message: "Not enough credits" } })
    return { usageLogId: "usage-1" }
  }),
}))

vi.mock("../../../lib/insert-job.js", () => ({
  insertSyncJob: vi.fn(async () => (state.insertFails ? { data: null, error: new Error("insert failed") } : { data: { id: "job-1" }, error: null })),
}))

vi.mock("../../../lib/metered-sync-completion.js", () => ({
  completeSettledSyncJob: vi.fn(async () => state.completes),
}))

vi.mock("../../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: vi.fn(async () => undefined),
  refundReservedCreditsForJob: vi.fn(async () => undefined),
}))

const { insertSyncJob } = await import("../../../lib/insert-job.js")
const { reserveCreditsForJob } = await import("../../../middleware/credit-guard.js")
const { completeSettledSyncJob } = await import("../../../lib/metered-sync-completion.js")
const { commitReservedCreditsForJob, refundReservedCreditsForJob } = await import("../../../lib/credits-job-lifecycle.js")
const { useCaseFeeCreditIdOf, useCaseFeeRoutes } = await import("../use-case-fee.js")

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  Object.assign(state, { userId: "user-1", guarded: [], noCredits: false, completes: true, insertFails: false })
  app = Fastify()
  app.addHook("onRequest", async (req) => {
    ;(req as unknown as { userId?: string }).userId = state.userId
  })
  await app.register(useCaseFeeRoutes)
})

afterEach(async () => {
  await app.close()
})

const charge = (body: unknown) => app.inject({ method: "POST", url: "/v1/use-case-fee", payload: body as Record<string, unknown> })

describe("the fee's price id", () => {
  it("is the node's own fee id for a use-case type, and the bare prefix (no price, so refused) for anything else", () => {
    expect(useCaseFeeCreditIdOf({ type: "clip-pack" })).toBe("use-case-fee:clip-pack")
    expect(useCaseFeeCreditIdOf({ type: "episode-chapters" })).toBe("use-case-fee:episode-chapters")
    expect(useCaseFeeCreditIdOf({ type: "generate-image" })).toBe("use-case-fee")
    expect(useCaseFeeCreditIdOf(null)).toBe("use-case-fee")
  })
})

describe("POST /v1/use-case-fee", () => {
  it("holds the fee at its own price, settles it on a job of its own, and answers the job", async () => {
    const res = await charge({ type: "episode-trailer", workflowId: "wf-1" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(state.guarded).toEqual(["use-case-fee:episode-trailer"])
    expect(insertSyncJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ user_id: "user-1", status: "pending", input_data: { type: "use-case-fee", feeOf: "episode-trailer" } }))
    expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "use-case-fee:episode-trailer")
    expect(completeSettledSyncJob).toHaveBeenCalledWith("job-1", { userId: "user-1" })
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("refuses a type that is not a use-case node before anything is held", async () => {
    const res = await charge({ type: "generate-image" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(insertSyncJob).not.toHaveBeenCalled()
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("asks for a sign-in", async () => {
    state.userId = undefined
    const res = await charge({ type: "clip-pack" })
    expect(res.statusCode).toBe(401)
    expect(insertSyncJob).not.toHaveBeenCalled()
  })

  it("stops at the hold when the credits do not cover the fee", async () => {
    state.noCredits = true
    const res = await charge({ type: "clip-pack" })
    expect(res.statusCode).toBe(402)
    expect(completeSettledSyncJob).not.toHaveBeenCalled()
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("gives the hold back when the fee's job cannot be completed", async () => {
    state.completes = false
    const res = await charge({ type: "clip-pack" })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("holds nothing when its job row cannot be written", async () => {
    state.insertFails = true
    const res = await charge({ type: "clip-pack" })
    expect(res.statusCode).toBe(500)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })
})
