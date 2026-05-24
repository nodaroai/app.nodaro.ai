import { describe, it, expect, beforeEach, vi } from "vitest"
import Fastify, { FastifyInstance } from "fastify"
import { imageCriticRoutes } from "../image-critic.js"
import sharp from "sharp"
import { randomBytes } from "node:crypto"

vi.mock("@/lib/llm-client.js", () => ({
  llmComplete: vi.fn(),
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({
  markProviderCallStart: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/safe-fetch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/safe-fetch.js")>()
  return { ...actual, safeFetch: vi.fn() }
})
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: vi.fn().mockResolvedValue(undefined),
  refundReservedCreditsForJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "ul-1" }),
}))
vi.mock("@/lib/supabase.js", () => {
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null }),
    }),
  })
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
  return {
    supabase: { from: vi.fn().mockReturnValue({ insert, update }) },
  }
})

import { llmComplete } from "@/lib/llm-client.js"
import { safeFetch } from "@/lib/safe-fetch.js"

const VALID_BODY = {
  imageUrl: "https://example.com/img.jpg",
  mode: "realism",
  threshold: 0.7,
}

function buildResponse(score: number, feedback = "Looks alright.") {
  return {
    text: JSON.stringify({ score, feedback }),
    usage: { inputTokens: 100, outputTokens: 30 },
    model: "claude-sonnet-4-6",
  }
}

async function setupApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req: any) => { req.userId = "user-1" })
  await app.register(imageCriticRoutes)
  return app
}

describe("POST /v1/image-critic", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(safeFetch as any).mockRejectedValue(new Error("test: skip prefetch"))
  })

  it("returns flat response shape with approved=true above threshold", async () => {
    ;(llmComplete as any).mockResolvedValue(buildResponse(0.82))
    const app = await setupApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-critic",
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      jobId: "job-1",
      score: 0.82,
      approved: true,
      feedback: "Looks alright.",
    })
  })

  it("returns approved=false when score below threshold", async () => {
    ;(llmComplete as any).mockResolvedValue(buildResponse(0.4))
    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })
    expect(res.json()).toMatchObject({ score: 0.4, approved: false })
  })

  it("boundary score == threshold counts as approved", async () => {
    ;(llmComplete as any).mockResolvedValue(buildResponse(0.7))
    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })
    expect(res.json()).toMatchObject({ score: 0.7, approved: true })
  })

  it("returns 400 missing_reference for character-consistency w/o referenceImageUrl", async () => {
    const app = await setupApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-critic",
      payload: { ...VALID_BODY, mode: "character-consistency" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("missing_reference")
  })

  it("returns 400 missing_prompt for prompt-adherence w/o prompt", async () => {
    const app = await setupApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-critic",
      payload: { ...VALID_BODY, mode: "prompt-adherence" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("missing_prompt")
  })

  it("returns 502 invalid_llm_output on non-JSON response", async () => {
    ;(llmComplete as any).mockResolvedValue({
      text: "Sure! I think the image looks great.",
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "x",
    })
    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("invalid_llm_output")
  })

  it("returns 502 on JSON parse success but Zod failure (e.g., score 1.5)", async () => {
    ;(llmComplete as any).mockResolvedValue({
      text: JSON.stringify({ score: 1.5, feedback: "x" }),
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "x",
    })
    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("invalid_llm_output")
  })

  it("safeFetch failure degrades to URL pass-through (does not 400)", async () => {
    ;(safeFetch as any).mockRejectedValue(new Error("ssrf-block"))
    ;(llmComplete as any).mockResolvedValue(buildResponse(0.8))
    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })
    expect(res.statusCode).toBe(200)
    expect(res.json().approved).toBe(true)
  })

  it("'all' mode aggregates score=min(perMode) and concatenates feedback worst-first", async () => {
    ;(llmComplete as any).mockResolvedValue({
      text: JSON.stringify({
        score: 0.55,
        feedback: "Anatomy issues.",
        perMode: {
          realism:  { score: 0.72, feedback: "Skin too plastic." },
          anatomy:  { score: 0.55, feedback: "Reshape the left hand." },
          aesthetic: { score: 0.81, feedback: "Composition fine." },
        },
      }),
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "x",
    })
    const app = await setupApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-critic",
      payload: { ...VALID_BODY, mode: "all" },
    })
    const body = res.json()
    expect(body.score).toBe(0.55)
    expect(body.feedback.startsWith("Reshape the left hand.")).toBe(true)
  })

  it("'all' mode with empty perMode falls back to top-level score", async () => {
    ;(llmComplete as any).mockResolvedValue({
      text: JSON.stringify({ score: 0.65, feedback: "Acceptable.", perMode: {} }),
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "x",
    })
    const app = await setupApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-critic",
      payload: { ...VALID_BODY, mode: "all" },
    })
    expect(res.json().score).toBe(0.65)
  })

  it("strips ```json markdown fences before parsing", async () => {
    ;(llmComplete as any).mockResolvedValue({
      text: "```json\n" + JSON.stringify({ score: 0.91, feedback: "All good." }) + "\n```",
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "x",
    })
    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })
    expect(res.statusCode).toBe(200)
    expect(res.json().score).toBe(0.91)
  })

  it("extracts first {...} block when prose surrounds the JSON", async () => {
    ;(llmComplete as any).mockResolvedValue({
      text: `Here's my evaluation: ${JSON.stringify({ score: 0.5, feedback: "Mid." })}. Hope that helps!`,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "x",
    })
    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })
    expect(res.statusCode).toBe(200)
    expect(res.json().score).toBe(0.5)
  })

  // --- oversized-image handling (Anthropic rejects base64 images > 5 MB) ---

  function mockFetchReturning(buf: Buffer, contentType: string) {
    ;(safeFetch as any).mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null),
      },
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    })
  }

  function imageBlockSentToClaude() {
    const call = (llmComplete as any).mock.calls[0][0]
    return call.messages[0].content.find((b: any) => b.type === "image_base64")
  }

  it("downsizes an oversized image so the base64 payload stays under Anthropic's 5 MB cap", async () => {
    // Random noise is ~incompressible, so this PNG lands well over the raw-byte
    // budget — mirroring the 6.3 MB PNG (→ 8.4 MB base64) that triggered the 400.
    const big = await sharp(randomBytes(1800 * 1800 * 3), {
      raw: { width: 1800, height: 1800, channels: 3 },
    })
      .png()
      .toBuffer()
    expect(big.byteLength).toBeGreaterThan(3_500_000) // sanity: genuinely oversized
    mockFetchReturning(big, "image/png")
    ;(llmComplete as any).mockResolvedValue(buildResponse(0.8))

    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })

    expect(res.statusCode).toBe(200)
    const block = imageBlockSentToClaude()
    expect(block).toBeTruthy()
    expect(block.data.length).toBeLessThanOrEqual(5_242_880) // base64 string ≤ 5 MB
    expect(block.mediaType).toBe("image/jpeg") // re-encoded on the downscale path
  })

  it("sends a small image as base64 untouched (no re-encode)", async () => {
    const small = await sharp({
      create: { width: 48, height: 48, channels: 3, background: "#777777" },
    })
      .png()
      .toBuffer()
    expect(small.byteLength).toBeLessThan(3_500_000)
    mockFetchReturning(small, "image/png")
    ;(llmComplete as any).mockResolvedValue(buildResponse(0.8))

    const app = await setupApp()
    const res = await app.inject({ method: "POST", url: "/v1/image-critic", payload: VALID_BODY })

    expect(res.statusCode).toBe(200)
    const block = imageBlockSentToClaude()
    expect(block.mediaType).toBe("image/png") // original encoding preserved
    expect(block.data).toBe(small.toString("base64"))
  })
})
