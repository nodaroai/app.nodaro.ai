import { describe, it, expect, beforeEach, vi } from "vitest"
import Fastify from "fastify"
import { llmChatRoutes } from "../llm-chat.js"
import { markProviderCallStart } from "../../lib/reconcile/persistence.js"
import { llmComplete } from "../../lib/llm-client.js"
import { LlmContentRefusalError, LlmOutputTruncatedError } from "../../lib/llm-errors.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { withJobSubmissionContext } from "../../lib/job-submission-context.js"

const { jobUpdates, jobInserts, credits } = vi.hoisted(() => ({
  jobUpdates: [] as Array<Record<string, unknown>>,
  jobInserts: [] as Array<Record<string, unknown>>,
  credits: { commitCredits: vi.fn(async () => undefined), refundCredits: vi.fn(async () => undefined) },
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "ul-1" })),
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        jobInserts.push(row)
        return {
        select: () => ({
          single: async () => ({ data: { id: "job-1" }, error: null }),
        }),
        }
      },
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

// The stream route takes the user's llm slot before it reads documents; the
// take is recorded here (the lanes have their own suites).
const lanes = vi.hoisted(() => ({ order: [] as string[], refuse: null as null | Error }))
vi.mock("../../lib/concurrency-lanes/request-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/concurrency-lanes/request-scope.js")>()
  return {
    ...actual,
    acquireLiveLane: vi.fn(async () => {
      lanes.order.push("lane")
      if (lanes.refuse) throw lanes.refuse
      return { release: async () => undefined }
    }),
  }
})

// Documents are read by `prepareLlmFiles` (its own suite: llm-files.test.ts);
// here it answers from a table, or refuses as it would.
const files = vi.hoisted(() => ({ prepared: [] as string[][], refuse: null as null | { code: string; message: string } }))
vi.mock("../../lib/llm-files.js", () => {
  class LlmFileError extends Error {
    constructor(readonly code: string, message: string) {
      super(message)
    }
  }
  return {
    LlmFileError,
    prepareLlmFiles: vi.fn(async (urls: string[]) => {
      lanes.order.push("files")
      files.prepared.push(urls)
      if (files.refuse) throw new LlmFileError(files.refuse.code, files.refuse.message)
      return urls.map((url, i) => ({ type: "file_base64", mediaType: "application/pdf", data: "JVBERi0=", filename: `f${i}.pdf`, pages: 3 }))
    }),
  }
})

// How a call's documents reach the aggregator's lane is planned before the
// hold and stored around the call (`lib/llm-file-link.ts`, its own suite:
// llm-file-link.test.ts); here the three steps record their calls and answer
// from a table, or refuse as they would.
const links = vi.hoisted(() => ({
  planned: [] as Array<{ urls: string[]; opts: unknown }>,
  refuse: null as null | { code: string; message: string },
  stored: [] as string[],
  discarded: [] as Array<{ urls: string[]; jobId: string }>,
}))
vi.mock("../../lib/llm-file-link.js", async () => {
  const { LlmFileError } = await import("../../lib/llm-files.js")
  return {
    planLlmFileLinks: vi.fn(async (urls: string[], blocks: Array<Record<string, unknown>>, opts: unknown) => {
      links.planned.push({ urls, opts })
      if (links.refuse) throw new (LlmFileError as unknown as new (code: string, message: string) => Error)(links.refuse.code, links.refuse.message)
      return blocks.map((block, i) => ({ block, via: urls[i]!.includes("big") ? "copy" : "inline" }))
    }),
    storeLlmFileLinks: vi.fn(async (plan: Array<{ block: Record<string, unknown>; via: string }>, jobId: string, stored: string[]) => {
      links.stored.push(jobId)
      return plan.map((step) => {
        if (step.via === "inline") return step.block
        const url = `https://media.example/tmp/provider-input/${jobId}/llm-file-1.pdf`
        stored.push(url)
        return { ...step.block, hostedUrl: url }
      })
    }),
    discardLlmFileLinks: vi.fn(async (urls: string[], jobId: string) => {
      links.discarded.push({ urls: [...urls], jobId })
    }),
  }
})

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

  it("records the model it runs on the row — the feature default when the body names none", async () => {
    jobInserts.length = 0
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: { systemPrompt: "", userInput: "hello" } })
    expect(res.statusCode).toBe(200)
    const row = jobInserts[0] as { input_data: Record<string, unknown> }
    expect(row.input_data.llmModel).toBeUndefined()
    expect(row.input_data.resolvedModel).toBe(LLM_FEATURE_DEFAULTS["llm-chat"])
    expect(llmComplete).toHaveBeenCalledWith(expect.objectContaining({ modelId: LLM_FEATURE_DEFAULTS["llm-chat"] }))
  })

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

  it.each([
    ["video", { referenceVideoUrls: ["https://x/y.mp4"] }],
    ["audio", { referenceAudioUrls: ["https://x/y.mp3"] }],
  ])("accepts a %s ref on gemini-4-hydrogen (decided 2026-11-16)", async (_kind, refs) => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: { systemPrompt: "", userInput: "describe this", llmModel: "gemini-4-hydrogen", ...refs },
    })
    expect(res.statusCode).toBe(200)
    expect(llmComplete).toHaveBeenCalledWith(expect.objectContaining({ modelId: "gemini-4-hydrogen" }))
  })

  it.each([
    ["video", { referenceVideoUrls: ["https://x/y.mp4"] }],
    ["audio", { referenceAudioUrls: ["https://x/y.mp3"] }],
  ])("still refuses a %s ref on gemini-4-argon, naming no vendor", async (kind, refs) => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/llm-chat/generate",
      payload: { systemPrompt: "", userInput: "describe this", llmModel: "gemini-4-argon", ...refs },
    })
    expect(res.statusCode).toBe(400)
    const { error } = JSON.parse(res.body)
    expect(error).toMatchObject({ code: "modality_not_supported", message: expect.stringContaining(`Switch to a model that reads ${kind}`) })
    expect(error.message).not.toMatch(/Gemini/)
    expect(llmComplete).not.toHaveBeenCalled()
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

// Documents (decided 2026-11-13): read only by a model whose caps say `file`
// (GPT-6.1 Terra), each read and checked before any job row or hold.
describe("POST /v1/llm-chat/generate — documents (referenceFileUrls)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobInserts.length = 0
    files.prepared.length = 0
    files.refuse = null
  })
  const payload = (llmModel: string, referenceFileUrls: string[]) => ({ systemPrompt: "", userInput: "summarise", llmModel, referenceFileUrls })

  it("sends GPT-6.1 Terra its documents as inline file blocks before the prompt", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gpt-6.1-terra", ["https://media.example/a.pdf", "https://media.example/b.pdf"]) })
    expect(res.statusCode).toBe(200)
    expect(files.prepared).toEqual([["https://media.example/a.pdf", "https://media.example/b.pdf"]])
    // The client's disconnect stops the reads (fetches and page counts).
    const { prepareLlmFiles } = await import("../../lib/llm-files.js")
    // …and the user's one turn of document reads here.
    expect(vi.mocked(prepareLlmFiles).mock.calls[0]![1]).toEqual({ signal: expect.any(AbortSignal), owner: "u1" })
    const content = vi.mocked(llmComplete).mock.calls[0]![0].messages[0]!.content as Array<{ type: string; pages?: number }>
    expect(content.map((b) => b.type)).toEqual(["file_base64", "file_base64", "text"])
    expect(content[0]!.pages).toBe(3)
    // The row records the links as given.
    expect((jobInserts[0] as { input_data: Record<string, unknown> }).input_data.referenceFileUrls).toEqual(["https://media.example/a.pdf", "https://media.example/b.pdf"])
  })

  it.each(["claude-sonnet-5.5", "gemini-3.6-flash", "gpt-6.1-sol"])("refuses files on %s with 400 modality_not_supported — nothing fetched, no job, nothing held", async (llmModel) => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload(llmModel, ["https://media.example/a.pdf"]) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatchObject({ code: "modality_not_supported", message: expect.stringContaining("GPT-6.1 Terra") })
    expect(files.prepared).toEqual([])
    expect(jobInserts).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("answers a file the reader refuses with its 400 — no job, nothing held, no call", async () => {
    files.refuse = { code: "file_type_not_supported", message: "The file at https://media.example/a.txt is not a PDF. Only PDF files can be read." }
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gpt-6.1-terra", ["https://media.example/a.txt"]) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("file_type_not_supported")
    expect(jobInserts).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("answers 503 with Retry-After when every PDF reader is busy — nothing held", async () => {
    files.refuse = { code: "file_reader_busy", message: "We're reading a lot of documents right now. Try again in a moment." }
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gpt-6.1-terra", ["https://media.example/a.pdf"]) })
    expect(res.statusCode).toBe(503)
    expect(res.headers["retry-after"]).toBe("5")
    expect(JSON.parse(res.body).error.code).toBe("file_reader_busy")
    expect(jobInserts).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("the stream route takes the user's llm slot before it reads documents, and a busy slot reads none", async () => {
    lanes.order.length = 0
    lanes.refuse = null
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: payload("gpt-6.1-terra", ["https://media.example/a.pdf"]) })
    expect(lanes.order.slice(0, 2)).toEqual(["lane", "files"])
    lanes.order.length = 0
    files.prepared.length = 0
    jobInserts.length = 0
    const { LaneBusyError } = await import("../../lib/concurrency-lanes/errors.js")
    lanes.refuse = new LaneBusyError()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: payload("gpt-6.1-terra", ["https://media.example/a.pdf"]) })
    lanes.refuse = null
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).error.code).toBe("lane_busy")
    expect(files.prepared).toEqual([])
    expect(jobInserts).toEqual([])
  })

  it("refuses more than 5 files at validation", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gpt-6.1-terra", Array.from({ length: 6 }, (_, i) => `https://media.example/${i}.pdf`)) })
    expect(res.statusCode).toBe(400)
    expect(files.prepared).toEqual([])
  })

  it("the stream route reads and refuses files the same way", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: payload("claude-sonnet-5.5", ["https://media.example/a.pdf"]) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("modality_not_supported")
    files.refuse = { code: "file_unreadable", message: "We couldn't read the pages of the PDF." }
    const refused = await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: payload("gpt-6.1-terra", ["https://media.example/a.pdf"]) })
    expect(refused.statusCode).toBe(400)
    expect(JSON.parse(refused.body).error.code).toBe("file_unreadable")
    expect(jobInserts).toEqual([])
  })
})

// Gemini 4 Hydrogen reads documents too (decided 2026-11-17). A call whose
// attachments are files runs on the aggregator's lane like a text call, with
// a floor that catches a dropped file. That lane takes files inline up to a
// limit and the rest by a stored link: the plan is made before anything is
// held, the copies stored once the job exists and deleted when the call ends.
describe("POST /v1/llm-chat/generate — documents on Gemini 4 Hydrogen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobInserts.length = 0
    files.prepared.length = 0
    files.refuse = null
    links.planned.length = 0
    links.refuse = null
    links.stored.length = 0
    links.discarded.length = 0
  })
  const payload = (llmModel: string, referenceFileUrls: string[], extra: Record<string, unknown> = {}) => ({ systemPrompt: "", userInput: "summarise", llmModel, referenceFileUrls, ...extra })
  const sent = () => vi.mocked(llmComplete).mock.calls[0]![0]
  const withGeminiKey = async () => {
    const { config } = (await import("../../lib/config.js")) as unknown as { config: Record<string, unknown> }
    config.GEMINI_API_KEY = "gem"
    return () => {
      delete config.GEMINI_API_KEY
    }
  }

  it("plans before the hold, stores the copy in the job's folder for the call, and deletes it after", async () => {
    const app = await buildApp()
    const urls = ["https://media.example/a.pdf", "https://elsewhere.example/big.pdf"]
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gemini-4-hydrogen", urls) })
    expect(res.statusCode).toBe(200)
    expect(files.prepared).toEqual([urls])
    expect(links.planned).toEqual([{ urls, opts: { owner: "u1" } }])
    expect(links.stored).toHaveLength(1)
    const stored = `https://media.example/tmp/provider-input/${links.stored[0]}/llm-file-1.pdf`
    const content = sent().messages[0]!.content as Array<Record<string, unknown>>
    expect(content.map((b) => [b.type, b.hostedUrl])).toEqual([["file_base64", undefined], ["file_base64", stored], ["text", undefined]])
    expect(links.discarded).toEqual([{ urls: [stored], jobId: links.stored[0] }])
  })

  it("a file-only call is not moved to the vendor's own API, even where a video call would be: it keeps its lane with a floor of 450 tokens a page", async () => {
    const restore = await withGeminiKey()
    try {
      const app = await buildApp()
      const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gemini-4-hydrogen", ["https://media.example/a.pdf", "https://media.example/b.pdf"]) })
      expect(res.statusCode).toBe(200)
      expect(sent().requireLane).toBeUndefined()
      // "summarise" is 1 token; 2 files of 3 pages at 450 a page.
      expect(sent().minPromptTokens).toBe(2701)
      // Every file fits inline: nothing stored, nothing to delete.
      expect(links.stored).toEqual([])
      expect(links.discarded).toEqual([])
    } finally {
      restore()
    }
  })

  it("a file the lane cannot be given is refused with its 400 — no job, nothing held, nothing stored, no call", async () => {
    links.refuse = { code: "file_too_large", message: "Files may total up to 0.9 MB for this model on this install." }
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gemini-4-hydrogen", ["https://media.example/big.pdf"]) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toEqual({ code: "file_too_large", message: links.refuse.message })
    expect(jobInserts).toEqual([])
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(llmComplete).not.toHaveBeenCalled()
    expect(links.stored).toEqual([])
  })

  it("a call refused at its reservation leaves nothing behind: no copy is stored", async () => {
    vi.mocked(reserveCreditsForJob).mockImplementationOnce(async (_req, reply) => {
      await (reply as unknown as { status: (n: number) => { send: (b: unknown) => unknown } }).status(402).send({ error: { code: "insufficient_credits" } })
      return undefined as never
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gemini-4-hydrogen", ["https://elsewhere.example/big.pdf"]) })
    expect(res.statusCode).toBe(402)
    expect(links.planned).toHaveLength(1)
    expect(links.stored).toEqual([])
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("a failed call still deletes its copy", async () => {
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("provider down"))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gemini-4-hydrogen", ["https://elsewhere.example/big.pdf"]) })
    expect(res.statusCode).toBe(502)
    expect(links.stored).toHaveLength(1)
    expect(links.discarded).toEqual([{ urls: [`https://media.example/tmp/provider-input/${links.stored[0]}/llm-file-1.pdf`], jobId: links.stored[0] }])
  })

  it("the stream route plans and refuses them the same way", async () => {
    links.refuse = { code: "upload_blocked", message: "Not allowed here." }
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: payload("gemini-4-hydrogen", ["https://media.example/big.pdf"]) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("upload_blocked")
    expect(jobInserts).toEqual([])
    expect(links.stored).toEqual([])
  })

  it("an Advanced-mode call runs on the vendor's own API, which the aggregator never backs up: the bytes go as they are, no plan, no copy", async () => {
    const restore = await withGeminiKey()
    try {
      const app = await buildApp()
      const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gemini-4-hydrogen", ["https://media.example/big.pdf"], { advancedMode: true }) })
      expect(res.statusCode).toBe(200)
      expect(links.planned).toEqual([])
      expect(links.stored).toEqual([])
      expect(sent()).toMatchObject({ requireLane: "direct" })
      expect((sent().messages[0]!.content as Array<Record<string, unknown>>)[0]).not.toHaveProperty("hostedUrl")
    } finally {
      restore()
    }
  })

  it("an install with no aggregator key serves the call on the vendor's own API: no plan, no file refused for its size", async () => {
    const { config } = (await import("../../lib/config.js")) as unknown as { config: Record<string, unknown> }
    const kie = config.KIE_API_KEY
    config.KIE_API_KEY = ""
    links.refuse = { code: "file_too_large", message: "would refuse" }
    try {
      const app = await buildApp()
      const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gemini-4-hydrogen", ["https://media.example/big.pdf"]) })
      expect(res.statusCode).toBe(200)
      expect(links.planned).toEqual([])
    } finally {
      config.KIE_API_KEY = kie
    }
  })

  it("GPT-6.1 Terra's call is unchanged: no stored link asked for, no pin, no floor", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gpt-6.1-terra", ["https://media.example/big.pdf"]) })
    expect(res.statusCode).toBe(200)
    expect(links.planned).toEqual([])
    expect(links.stored).toEqual([])
    expect(sent()).not.toHaveProperty("requireLane")
    expect(sent()).not.toHaveProperty("minPromptTokens")
    expect(sent().messages[0]!.content).toEqual([
      { type: "file_base64", mediaType: "application/pdf", data: "JVBERi0=", filename: "f0.pdf", pages: 3 },
      { type: "text", text: "summarise" },
    ])
  })

  it("a model that reads no files is told which models do", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload("gemini-4-carbon", ["https://media.example/a.pdf"]) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toEqual({ code: "modality_not_supported", message: "Model gemini-4-carbon does not read files. Switch to Gemini 4 Hydrogen or GPT-6.1 Terra." })
    expect(files.prepared).toEqual([])
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

describe("POST /v1/llm-chat/generate — a video frame rate (referenceVideoFps)", () => {
  // Advanced mode on a Gemini model needs this install's Gemini key; the suite's config holds none.
  const withGeminiKey = async () => {
    const { config } = (await import("../../lib/config.js")) as unknown as { config: Record<string, unknown> }
    config.GEMINI_API_KEY = "gem"
    return () => {
      delete config.GEMINI_API_KEY
    }
  }
  beforeEach(() => {
    vi.clearAllMocks()
    jobInserts.length = 0
  })
  const payload = (extra: Record<string, unknown>) => ({
    systemPrompt: "",
    userInput: "list the defects",
    referenceVideoUrls: ["https://media.example/cut.mp4"],
    llmModel: "gemini-3.8-flash",
    ...extra,
  })
  const videoBlocks = () =>
    (vi.mocked(llmComplete).mock.calls[0]![0].messages[0]!.content as Array<Record<string, unknown>>).filter((b) => b.type === "video")

  it("sends each video with the rate, on the provider's own lane, when Advanced mode is on", async () => {
    const restore = await withGeminiKey()
    try {
      const app = await buildApp()
      const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload({ referenceVideoFps: 4, advancedMode: true }) })
      expect(res.statusCode).toBe(200)
      expect(videoBlocks()).toEqual([{ type: "video", url: "https://media.example/cut.mp4", fps: 4 }])
      expect(vi.mocked(llmComplete).mock.calls[0]![0]).toMatchObject({ requireLane: "direct" })
      // The row records what was asked.
      expect((jobInserts[0] as { input_data: Record<string, unknown> }).input_data.referenceVideoFps).toBe(4)
    } finally {
      restore()
    }
  })

  it("no rate asked: the video block carries none, as before the field existed", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload({}) })
    expect(res.statusCode).toBe(200)
    expect(videoBlocks()).toEqual([{ type: "video", url: "https://media.example/cut.mp4" }])
  })

  it("refuses a rate without Advanced mode with 400 video_fps_needs_advanced_mode: no job, no call", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload({ referenceVideoFps: 4 }) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatchObject({ code: "video_fps_needs_advanced_mode", message: expect.stringContaining("advancedMode: true") })
    expect(jobInserts).toHaveLength(0)
    expect(llmComplete).not.toHaveBeenCalled()
  })

  it("refuses a rate with no video with 400 video_fps_without_video", async () => {
    const restore = await withGeminiKey()
    try {
      const app = await buildApp()
      const res = await app.inject({
        method: "POST",
        url: "/v1/llm-chat/generate",
        payload: { systemPrompt: "", userInput: "hello", llmModel: "gemini-3.8-flash", referenceVideoFps: 4, advancedMode: true },
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error.code).toBe("video_fps_without_video")
      expect(llmComplete).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it.each([0, -2, 24.5, 60])("refuses a rate of %s at validation", async (fps) => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload({ referenceVideoFps: fps, advancedMode: true }) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("validation_error")
  })

  it("a model with no lane of its own for Advanced mode is refused by that rule first", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload({ referenceVideoFps: 4, advancedMode: true }) })
    // No Gemini key on this install: Advanced mode itself cannot run.
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("advanced_mode_unavailable")
  })

  it("the stream route refuses a rate without Advanced mode the same way", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: payload({ referenceVideoFps: 4 }) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBe("video_fps_needs_advanced_mode")
  })
})

describe("POST /v1/llm-chat/generate — the caller learns the job before the answer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobInserts.length = 0
  })
  const call = { userId: "u1", method: "POST", url: "/v1/llm-chat/generate" }

  it("tells a listening caller the job's id once the row exists, before the model is called", async () => {
    const app = await buildApp()
    const heard: string[] = []
    let heardAtModelCall: string[] | null = null
    vi.mocked(llmComplete).mockImplementationOnce(async () => {
      heardAtModelCall = [...heard]
      return { text: "ok", usage: { inputTokens: 1, outputTokens: 1 } } as Awaited<ReturnType<typeof llmComplete>>
    })
    const res = await withJobSubmissionContext({ ...call, onJobCreated: (id) => heard.push(id) }, () =>
      app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: { systemPrompt: "", userInput: "hello" } }),
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ jobId: "job-1", generatedText: "ok" })
    expect(heard).toEqual(["job-1"])
    expect(heardAtModelCall).toEqual(["job-1"])
  })

  it("tells nobody about a request refused before its job exists", async () => {
    const app = await buildApp()
    const heard: string[] = []
    const res = await withJobSubmissionContext({ ...call, onJobCreated: (id) => heard.push(id) }, () =>
      app.inject({
        method: "POST",
        url: "/v1/llm-chat/generate",
        payload: { systemPrompt: "", userInput: "describe this", referenceVideoUrls: ["https://x/y.mp4"], llmModel: "claude-sonnet-4.6" },
      }),
    )
    expect(res.statusCode).toBe(400)
    expect(heard).toEqual([])
    expect(jobInserts).toHaveLength(0)
  })
})

describe("POST /v1/llm-chat/generate — a video or audio the model never read (tier pricing: the floor)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobInserts.length = 0
    jobUpdates.length = 0
  })
  const payload = (extra: Record<string, unknown>) => ({ systemPrompt: "", userInput: "describe it", llmModel: "gemini-3.8-flash", ...extra })

  it("sends a call with a video its floor of prompt tokens, and keeps its lane", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload({ referenceVideoUrls: ["https://media.example/cut.mp4"] }) })
    expect(res.statusCode).toBe(200)
    const request = vi.mocked(llmComplete).mock.calls[0]![0]
    // "describe it": 1 token at 8 characters a token, plus one video.
    expect(request.minPromptTokens).toBe(61)
    expect(request.requireLane).toBeUndefined()
  })

  it("sends a call with no video and no audio no floor at all", async () => {
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload({ referenceImageUrls: ["https://media.example/a.png"] }) })
    const request = vi.mocked(llmComplete).mock.calls[0]![0]
    expect(request).not.toHaveProperty("minPromptTokens")
    expect(request).not.toHaveProperty("requireLane")
  })

  it("an answer made without the media is a 502 media_not_ingested in plain words, refunded, never a completed job", async () => {
    vi.mocked(llmComplete).mockRejectedValueOnce(
      new Error("media_not_ingested:gemini-3.8-flash — provider reported 11 prompt tokens, below the 61 floor for this request's media. The response describes content the model was not shown; discarding it."),
    )
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: payload({ referenceVideoUrls: ["https://media.example/cut.mp4"] }) })
    expect(res.statusCode).toBe(502)
    const error = JSON.parse(res.body).error
    expect(error.code).toBe("media_not_ingested")
    expect(error.message).toBe("The model answered without reading the video, audio or file you sent, so the answer was discarded. Run it again.")
    expect(error.message).not.toMatch(/provider|prompt tokens/)
    expect(credits.refundCredits).toHaveBeenCalledWith("ul-1")
    expect(credits.commitCredits).not.toHaveBeenCalled()
    expect(jobUpdates.some((u) => u.status === "completed")).toBe(false)
  })
})
