import { describe, it, expect, beforeEach, vi } from "vitest"
import Fastify from "fastify"
import { llmChatRoutes } from "../llm-chat.js"
import { markProviderCallStart } from "../../lib/reconcile/persistence.js"
import { llmComplete } from "../../lib/llm-client.js"
import { LlmContentRefusalError, LlmOutputTruncatedError } from "../../lib/llm-errors.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

const { jobUpdates, credits } = vi.hoisted(() => ({
  jobUpdates: [] as Array<Record<string, unknown>>,
  credits: { commitCredits: vi.fn(async () => undefined), refundCredits: vi.fn(async () => undefined) },
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "ul-1" })),
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "job-1" }, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        jobUpdates.push(payload)
        // self-chaining thenable: supports `.eq(...).eq(...)` (id + user_id scope) and `await`
        // (markJobFailed's CAS continues with .in("status", …).select("id")).
        const chain: { eq: () => typeof chain; in: () => typeof chain; select: () => typeof chain; then: (r: (v: { error: null }) => void) => void } = {
          eq: () => chain,
          in: () => chain,
          select: () => chain,
          then: (resolve) => resolve({ error: null }),
        }
        return chain
      },
    }),
  },
}))

vi.mock("../../lib/llm-client.js", () => ({
  llmComplete: vi.fn(async () => ({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } })),
  llmStream: vi.fn(),
}))

vi.mock("../../ee/billing/credits.js", () => ({ CreditsService: credits }))

// D6: metered is the default. This suite pins the TIER behaviour, so it runs
// under LLM_TIER_PRICING_ROLLBACK; the metered paths (and the rollback's
// byte-identical reservation) are in llm-metered-text-routes.test.ts.
vi.mock("../../lib/config.js", () => ({
  config: { KIE_API_KEY: "kie", ANTHROPIC_API_KEY: "ant", LLM_TIER_PRICING_ROLLBACK: true },
  // The job-insert block check (lib/access-blocks.ts) has its own suite.
  hasAdmin: () => false,
  hasCredits: () => true,
  llmMeteredPricing: () => false,
}))

vi.mock("../../lib/reconcile/persistence.js", () => ({
  markProviderCallStart: vi.fn(async () => undefined),
}))

async function buildApp() {
  const app = Fastify()
  // Stub raw.setTimeout / once on inject's fake req+reply BEFORE preHandler runs.
  // light-my-request's Request/Response don't expose .socket, so the real
  // IncomingMessage.setTimeout (which reaches into socket.setTimeout) blows up
  // with "listener must be a function". Override with a no-op for tests.
  app.addHook("onRequest", async (req, reply) => {
    ;(req.raw as { setTimeout: (ms: number) => void }).setTimeout = () => {}
    ;(reply.raw as { setTimeout: (ms: number) => void }).setTimeout = () => {}
    if (typeof (req.raw as { once?: unknown }).once !== "function") {
      ;(req.raw as { once: (event: string, listener: () => void) => void }).once = () => {}
    }
  })
  app.addHook("preHandler", async (req) => { (req as { userId?: string }).userId = "u1" })
  await app.register(llmChatRoutes)
  return app
}

describe("POST /v1/llm-chat/generate — capability filter", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects video ref + claude with 400 modality_not_supported", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "describe this",
        referenceVideoUrls: ["https://x/y.mp4"],
        llmModel: "claude-sonnet-4.6",
      },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe("modality_not_supported")
  })

  it("accepts video ref + gemini-3-flash", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "describe this",
        referenceVideoUrls: ["https://x/y.mp4"],
        llmModel: "gemini-3-flash",
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it("rejects audio ref + gpt-5.4 with 400", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "transcribe",
        referenceAudioUrls: ["https://x/y.mp3"],
        llmModel: "gpt-5.4",
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it("accepts image ref + claude (preserves prior behavior)", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "describe",
        referenceImageUrls: ["https://x/y.png"],
        llmModel: "claude-sonnet-4.6",
      },
    })
    expect(res.statusCode).toBe(200)
  })

  it("accepts reasoningEffort and forwards it to llmComplete", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "describe",
        referenceImageUrls: ["https://x/y.png"],
        llmModel: "claude-sonnet-4.6",
        reasoningEffort: "max",
      },
    })
    expect(res.statusCode).toBe(200)

    const forwarded = vi.mocked(llmComplete).mock.calls[0][0]
    expect(forwarded.reasoningEffort).toBe("max")
  })

  it("reserves credits at the tier-bumped identifier when reasoningEffort clamps to max (guard/reserve parity)", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "describe",
        referenceImageUrls: ["https://x/y.png"],
        llmModel: "gpt-5.6-terra",
        reasoningEffort: "max",
      },
    })
    expect(res.statusCode).toBe(200)

    // gpt-5.6-terra is a "standard" tier model whose reasoningEfforts list
    // includes "max" — buildLlmCreditIdentifier bumps standard -> premium.
    // The reservation call must receive the SAME bumped identifier the
    // creditGuard preHandler gate-checked against, or the gate and the
    // reservation disagree and the job is under-billed.
    expect(reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "job-1",
      "llm-chat:premium",
    )
  })

  it("reserves a directOnly model (gemini-4-argon) on premium-direct — the rung of the only lane it runs on", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: { systemPrompt: "", userInput: "hi", llmModel: "gemini-4-argon" },
    })
    expect(res.statusCode).toBe(200)
    // The reservation is what the commit debits, so this is the charge.
    expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "llm-chat:premium-direct")
  })

  it("calls markProviderCallStart with anthropic-sync on success (reconcile parity)", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: {
        systemPrompt: "",
        userInput: "write something",
        llmModel: "claude-sonnet-4.6",
      },
    })
    expect(res.statusCode).toBe(200)
    expect(markProviderCallStart).toHaveBeenCalledTimes(1)
    expect(markProviderCallStart).toHaveBeenCalledWith("job-1", "anthropic-sync")
  })
})

describe("POST /v1/llm-chat/generate — a cut-off answer (#1588)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobUpdates.length = 0
  })

  it("fails the job and refunds instead of saving the fragment as completed", async () => {
    vi.mocked(llmComplete).mockRejectedValueOnce(new LlmOutputTruncatedError(
      "The answer was cut off: the model reached its 8192-token output limit before finishing",
      { inputTokens: 13_657, outputTokens: 8_192, providerCost: 0.03, complete: true },
    ))
    const app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: { systemPrompt: "", userInput: "write the brief", maxTokens: 1100 },
    })

    // The orchestrator reads a non-2xx sync-HTTP answer as a failed node, so the
    // run stops here instead of handing a fragment to the next node.
    expect(res.statusCode).toBe(502)
    expect(JSON.parse(res.body).error.message).toMatch(/cut off/)
    // The provider already billed the cut-off reply: its cost stays on the row,
    // or every cost report loses a real charge the old "completed" row carried.
    expect(jobUpdates).toEqual([expect.objectContaining({ status: "failed", provider_cost: 0.03 })])
    expect(jobUpdates.some((u) => u.status === "completed")).toBe(false)
    expect(credits.refundCredits).toHaveBeenCalledWith("ul-1")
    expect(credits.commitCredits).not.toHaveBeenCalled()
  })
})

describe("POST /v1/llm-chat/generate — a provider content stop (direct Gemini RECITATION, 2026-10-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobUpdates.length = 0
  })

  it("fails the job with the content-policy sentence and refunds — never a completed empty answer", async () => {
    vi.mocked(llmComplete).mockRejectedValueOnce(new LlmContentRefusalError(
      "Content policy violation (direct-gemini gemini-4-argon stopped with RECITATION)",
      { inputTokens: 94, outputTokens: 0, providerCost: 0.0004, complete: true },
    ))
    const app = await buildApp()

    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: { systemPrompt: "", userInput: "list them", llmModel: "gemini-4-argon" },
    })

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(JSON.parse(res.body).error.message).toMatch(/Content policy violation/)
    expect(jobUpdates).toEqual([expect.objectContaining({ status: "failed" })])
    expect(jobUpdates.some((u) => u.status === "completed")).toBe(false)
    // LLM Chat refunds every failed call, a billed refusal included.
    expect(credits.refundCredits).toHaveBeenCalledWith("ul-1")
    expect(credits.commitCredits).not.toHaveBeenCalled()
  })
})
