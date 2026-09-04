import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * The contract this pins: a sync-HTTP route that returns a `jobId` sends the
 * orchestrator down its job-POLLING branch, where the node's output is rebuilt
 * from the jobs row via `buildNodeOutputFromJobData` — NOT from the HTTP body.
 *
 * So the text has to live in `output_data`. When this route started returning a
 * jobId (for credit accounting) while writing only `{ latestId, count }`,
 * scheduled runs silently emitted an EMPTY output even though the HTTP response
 * still looked correct to the editor. Nothing threw.
 */

/** Every `.update()` payload written to `jobs`, in order. */
let jobUpdates: ReadonlyArray<Record<string, unknown>> = []

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        jobUpdates = [...jobUpdates, patch]
        const chain = { eq: () => chain, then: undefined }
        // Awaited by the route; resolve after the eq() chain.
        return Object.assign(Promise.resolve({ error: null }), chain)
      },
    }),
  },
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: async () => ({ usageLogId: "usage-1" }),
}))

vi.mock("../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: async () => {},
  refundReservedCreditsForJob: async () => 0,
}))

const fetchChannelPosts = vi.fn(async () => [
  { id: 10, text: "first post" },
  { id: 11, text: "second post" },
])
vi.mock("../../services/social/telegram-channel.js", () => ({
  fetchChannelPosts: () => fetchChannelPosts(),
  normalizeChannel: (c: string) => (c.startsWith("@") || /^[a-z0-9_]+$/i.test(c) ? c.replace("@", "") : null),
}))

import { telegramChannelRoutes } from "../telegram-channel.js"
import { clearJobPolicies, registerJobPolicy } from "../../lib/job-policy.js"

let app: FastifyInstance

beforeEach(async () => {
  jobUpdates = []
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    ;(req as { userId?: string }).userId = "user-1"
  })
  await app.register(telegramChannelRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/telegram-channel/fetch", () => {
  it("writes the post text into output_data, not just the cursor", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/telegram-channel/fetch",
      payload: { channel: "@somechannel" },
    })

    expect(r.statusCode).toBe(200)

    const completed = jobUpdates.find((u) => u.status === "completed")
    expect(completed, "job was never marked completed").toBeTruthy()

    const output = completed!.output_data as Record<string, unknown>
    // buildNodeOutputFromJobData normalizes generatedText -> text; without it
    // the orchestrator's poll branch produces an empty node output.
    expect(output.generatedText, "output_data must carry the text for the poll branch").toContain("first post")
    expect(output.text).toContain("second post")
    expect(output.latestId).toBe(11)
  })

  it("returns a jobId, the response shape that selects the poll branch", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/telegram-channel/fetch",
      payload: { channel: "@somechannel" },
    })

    const body = r.json() as Record<string, unknown>
    expect(body.jobId).toBe("job-1")
    // The two must stay consistent: returning a jobId is what makes the
    // output_data assertion above load-bearing.
    expect(body.generatedText).toContain("first post")
  })

  it("rejects an invalid channel before creating a job", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/v1/telegram-channel/fetch",
      payload: { channel: "https://evil.example/x" },
    })

    expect(r.statusCode).toBe(400)
    expect(jobUpdates).toHaveLength(0)
  })
})

/** F10 — the documented 422 `job_blocked`, not a 500 the SDK retries with
 *  backoff. This file already imports `sendInternalError` for its other error
 *  paths; the insert error arm just never used it. */
describe("POST /v1/telegram-channel/fetch — request-gate block (F10)", () => {
  afterEach(() => clearJobPolicies())

  it("answers 422 job_blocked and never fetches the channel", async () => {
    registerJobPolicy({
      id: "test-deny-all",
      checkRequest: () => ({ verdict: "block", reason: "test:denied", userMessage: "Not allowed here" }),
    })

    // This suite's mocks are module-level and not reset between cases.
    fetchChannelPosts.mockClear()

    const res = await app.inject({
      method: "POST",
      url: "/v1/telegram-channel/fetch",
      payload: { channel: "@somechannel" },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json()).toEqual({ error: { code: "job_blocked", message: "Not allowed here" } })
    expect(fetchChannelPosts).not.toHaveBeenCalled()
  })
})
