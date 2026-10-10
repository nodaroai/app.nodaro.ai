/**
 * The placement call prefetches the base image into bytes. On a Gemini model
 * served by KIE those bytes travel inline, never as the image's URL — KIE's
 * chat-completions lane fails every image sent as a URL. Exercised through the
 * real LLM client; only the network edges and the job/credit bookkeeping are
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import sharp from "sharp"

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  safeFetchBytes: vi.fn(),
  maybeProxyLlmRouteToCloud: vi.fn(),
  insertJob: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  markJobCompleted: vi.fn(),
  markJobFailed: vi.fn(),
  commitReservedCreditsForJob: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  markProviderCallStart: vi.fn(),
}))

// KIE only: no Anthropic key and no Gemini key, so the KIE leg is the only one.
vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
    NODE_ENV: "test",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/anthropic.js", () => ({ getAnthropicClient: () => ({}) }))
vi.mock("@/lib/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-fetch.js")>()),
  safeFetch: mocks.safeFetch,
}))
vi.mock("@/lib/safe-fetch-bytes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-fetch-bytes.js")>()),
  safeFetchBytes: mocks.safeFetchBytes,
}))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: mocks.maybeProxyLlmRouteToCloud }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
vi.mock("@/middleware/rate-limit.js", () => ({ rateLimiter: () => async () => {} }))
vi.mock("@/workers/shared.js", () => ({ markJobCompleted: mocks.markJobCompleted }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailed: mocks.markJobFailed }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: mocks.commitReservedCreditsForJob,
  refundReservedCreditsForJob: mocks.refundReservedCreditsForJob,
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))

import { imageOverlayPlacementRoutes } from "../image-overlay-placement.js"
import { KIE_IMAGE_FETCH_FAILED_MESSAGE } from "@/lib/kie-inline-image.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const IMAGE_URL = "https://cdn.example/images/poster.png"
const PLACEMENT = { anchor: "bottom-right", x: -4, y: -6, width: 12, reason: "Calm corner away from the face." }

describe("POST /v1/image-overlay/suggest-placement — Gemini on KIE gets the image inline", () => {
  let app: FastifyInstance
  let fetchMock: ReturnType<typeof vi.fn>
  let png: Buffer

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
    mocks.markJobCompleted.mockResolvedValue(true)
    mocks.markJobFailed.mockResolvedValue(true)
    mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
    mocks.refundReservedCreditsForJob.mockResolvedValue(0)
    mocks.markProviderCallStart.mockResolvedValue(undefined)

    png = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#406080" } }).png().toBuffer()
    mocks.safeFetch.mockImplementation(async () =>
      new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }),
    )
    fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: JSON.stringify(PLACEMENT) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 900, completion_tokens: 30 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await imageOverlayPlacementRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    vi.unstubAllGlobals()
  })

  it("sends the prefetched image inline, never its URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/image-overlay/suggest-placement",
      payload: { imageUrl: IMAGE_URL, llmModel: "gemini-3.8-flash", userId: USER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().placement).toEqual(PLACEMENT)
    expect(mocks.safeFetch).toHaveBeenCalledWith(IMAGE_URL, expect.anything())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const raw = (fetchMock.mock.calls[0]?.[1] as { body: string }).body
    const body = JSON.parse(raw) as { messages: Array<{ role: string; content: unknown }> }
    const user = body.messages.find((m) => m.role === "user")
    expect((user?.content as Array<Record<string, unknown>>)[0]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
    })
    expect(raw).not.toContain(IMAGE_URL)
  })

  // The prefetch could not read the image, so it reaches the KIE lane as a URL
  // — and KIE's own download fails too. With no second lane, the person reads
  // the plain sentence on the job, never the diagnostic.
  it("records an image it could not send as its plain sentence, never the diagnostic", async () => {
    mocks.safeFetch.mockImplementation(async () => new Response("missing", { status: 404 }))
    mocks.safeFetchBytes.mockRejectedValue(new Error("Image download failed"))

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-overlay/suggest-placement",
      payload: { imageUrl: IMAGE_URL, llmModel: "gemini-3.8-flash", userId: USER_ID },
    })

    expect(res.statusCode).toBe(502)
    // The answer says the same plain sentence the job does.
    expect(res.json().error).toEqual({ code: "llm_error", message: KIE_IMAGE_FETCH_FAILED_MESSAGE })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).toHaveBeenCalledWith("job-1", {
      error_message: KIE_IMAGE_FETCH_FAILED_MESSAGE,
      extra: { output_data: { error: KIE_IMAGE_FETCH_FAILED_MESSAGE } },
    })
    expect(JSON.stringify([res.json(), mocks.markJobFailed.mock.calls])).not.toMatch(/KIE|inline image/)
  })

  // A failure with no plain sentence of its own (the model never produced a
  // valid placement) keeps the route's own answer — never an internal message.
  it("answers its own sentence for a failure that has no plain sentence", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "not a placement" }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 3 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    const res = await app.inject({
      method: "POST",
      url: "/v1/image-overlay/suggest-placement",
      payload: { imageUrl: IMAGE_URL, llmModel: "gemini-3.8-flash", userId: USER_ID },
    })

    expect(res.statusCode).toBe(502)
    expect(res.json().error).toEqual({ code: "llm_error", message: "Could not suggest a placement" })
  })
})
