/**
 * When the LLM call fails, QA Check's answer and the failed job the person can
 * open carry the person-readable sentence of the failure — never the lane's
 * internal diagnostic, which names the vendor and the step that failed.
 *
 * QA Check sends text only, so the inline-image failure below is the shape of
 * the lane error rather than a path this route reaches; the second case is
 * the one it does reach (a KIE service error).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  insertJob: vi.fn(),
  jobUpdate: vi.fn(),
  llmComplete: vi.fn(),
  commitCredits: vi.fn(),
  refundCredits: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", KIE_API_KEY: "test-kie-key", ANTHROPIC_API_KEY: undefined, SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: vi.fn().mockResolvedValue(false) }))
// insertSyncJob shares the insertJob mock: same call shape, so the row assertions below read both.
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob, insertSyncJob: mocks.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1" }),
}))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { commitCredits: mocks.commitCredits, refundCredits: mocks.refundCredits },
}))
vi.mock("@/lib/llm-client.js", () => ({ llmComplete: mocks.llmComplete }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: (row: Record<string, unknown>) => {
        mocks.jobUpdate(row)
        // markJobFailed's CAS continues with .in("status", …).select("id").
        const done = Promise.resolve({ data: null, error: null })
        return { eq: vi.fn(() => Object.assign(done, { in: () => ({ select: () => done }) })) }
      },
    })),
  },
}))

import { qaCheckRoutes } from "../qa-check.js"
import { ADVANCED_MODE_UNAVAILABLE_MESSAGE, LlmAdvancedModeUnavailableError, LlmLaneError, LLM_ANSWER_UNREADABLE_MESSAGE } from "../../lib/llm-errors.js"
import { KIE_IMAGE_FETCH_FAILED_MESSAGE } from "../../lib/kie-inline-image.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"

describe("POST /v1/qa-check — a failure the person can read", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.refundCredits.mockResolvedValue(undefined)
    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      req.userId = USER_ID
    })
    await app.register(qaCheckRoutes)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  const post = () => app.inject({ method: "POST", url: "/v1/qa-check", payload: { content: "A short paragraph to check." } })

  it.each([
    [
      "an image the KIE lane could not download",
      new LlmLaneError("KIE inline image: could not fetch an image from cdn.example to send inline", {
        lane: "kie",
        userMessage: KIE_IMAGE_FETCH_FAILED_MESSAGE,
      }),
      KIE_IMAGE_FETCH_FAILED_MESSAGE,
    ],
    [
      "a KIE service error",
      new LlmLaneError("KIE.ai chat-completions gpt-5.2 failed (500): upstream timeout", { lane: "kie", httpStatus: 500 }),
      "The AI model's service is unavailable right now. Please try again later, or choose another model.",
    ],
  ])("passes %s on as its plain sentence, in the answer and on the job", async (_label, err, sentence) => {
    mocks.llmComplete.mockRejectedValue(err)

    const res = await post()

    expect(res.statusCode).toBe(502)
    expect(res.json().error).toEqual({ code: "llm_error", message: sentence })
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ status: "failed", error_message: sentence, completed_at: expect.any(String), output_data: { error: sentence } })
    expect(JSON.stringify([res.json(), mocks.jobUpdate.mock.calls])).not.toMatch(/KIE|inline image/)
    expect(mocks.refundCredits).toHaveBeenCalledWith("usage-1")
  })

  it("answers a neutral sentence — naming no vendor — for a failure that is not even an Error", async () => {
    mocks.llmComplete.mockRejectedValue("not an Error")

    const res = await post()

    expect(res.json().error.message).toBe(LLM_ANSWER_UNREADABLE_MESSAGE)
    expect(JSON.stringify(res.json())).not.toMatch(/Claude|Anthropic|KIE/)
  })

  it("still passes a non-lane error's own message through", async () => {
    mocks.llmComplete.mockRejectedValue(new Error("Model timed out"))

    const res = await post()

    expect(res.json().error.message).toBe("Model timed out")
  })

  it("an Advanced-mode refusal answers advanced_mode_unavailable, and the credits come back", async () => {
    mocks.llmComplete.mockRejectedValue(new LlmAdvancedModeUnavailableError("advanced mode: anthropic refused"))
    const res = await post()
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toEqual({ code: "advanced_mode_unavailable", message: ADVANCED_MODE_UNAVAILABLE_MESSAGE })
    expect(mocks.refundCredits).toHaveBeenCalledWith("usage-1")
  })
})
