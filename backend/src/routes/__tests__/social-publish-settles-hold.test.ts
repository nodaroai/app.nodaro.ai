/**
 * The synchronous POST /v1/social/publish settles its credit hold. It used to
 * mark the job completed and never commit, so every successful publish left
 * its `usage_logs` row `reserved` forever. The scheduled worker
 * (social-publish-worker.ts) always committed. Pinned here: a published post
 * commits exactly its own hold; a failed publish refunds it and never commits;
 * a commit failure after the post is out neither fails the request nor refunds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
  },
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "usage-1" })),
}))

vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: vi.fn(async () => {}) }))

const { executePublish } = vi.hoisted(() => ({ executePublish: vi.fn() }))
vi.mock("../../services/social/execute-publish.js", () => ({
  executePublish,
  NotConnectedError: class NotConnectedError extends Error {},
  UnknownOutcomeError: class UnknownOutcomeError extends Error {},
}))

const { commitCredits, refundCredits } = vi.hoisted(() => ({ commitCredits: vi.fn(), refundCredits: vi.fn() }))
vi.mock("../../ee/billing/credits.js", () => ({ CreditsService: { commitCredits, refundCredits } }))

import { socialPublishRoutes } from "../social-publish.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = "00000000-0000-4000-8000-000000000001"
  })
  await app.register(socialPublishRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const publish = () =>
  app.inject({
    method: "POST",
    url: "/v1/social/publish",
    payload: { platform: "telegram", action: "post-text", caption: "hi", chatId: "123" },
  })

describe("POST /v1/social/publish settles its credit hold", () => {
  it("commits exactly its own hold once the post is published", async () => {
    executePublish.mockResolvedValue({ platformPostId: "p1", platformPostUrl: "https://t.me/p1" })

    const res = await publish()

    expect(res.statusCode).toBe(200)
    expect(commitCredits).toHaveBeenCalledTimes(1)
    expect(commitCredits).toHaveBeenCalledWith("usage-1")
    expect(refundCredits).not.toHaveBeenCalled()
  })

  it("refunds and never commits when the publish fails", async () => {
    executePublish.mockRejectedValue(new Error("boom"))

    const res = await publish()

    expect(res.statusCode).toBe(500)
    expect(refundCredits).toHaveBeenCalledWith("usage-1")
    expect(commitCredits).not.toHaveBeenCalled()
  })

  it("a commit failure after the post is out still answers 200 and does not refund", async () => {
    executePublish.mockResolvedValue({ platformPostId: "p1", platformPostUrl: "https://t.me/p1" })
    commitCredits.mockRejectedValueOnce(new Error("rpc down"))

    const res = await publish()

    expect(res.statusCode).toBe(200)
    expect(refundCredits).not.toHaveBeenCalled()
  })
})
