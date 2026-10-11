/**
 * Describe to Picker on a Gemini model served by KIE, end to end through the
 * real prefetch and the real LLM client — only the network edges (and the
 * direct Gemini SDK, for the fallback case) are stubbed.
 *
 * KIE's chat-completions lane fails every image sent as a URL (`code 500:
 * Network error`), so the image always travels inline — resized to fit when
 * its data URL would pass the inline limit — wherever it is hosted. The job
 * records which lane served the answer in its admin-only `provider` column,
 * never in the owner-visible `output_data`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import sharp from "sharp"
import { randomBytes } from "node:crypto"

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  maybeProxyLlmRouteToCloud: vi.fn(),
  insertJob: vi.fn(),
  jobUpdate: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  commitReservedCreditsForJob: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  markProviderCallStart: vi.fn(),
  generateContent: vi.fn(),
}))

// KIE is the primary lane for gemini-3.8-flash; the Gemini key gives it the
// direct Google lane as a fallback. No Anthropic key.
vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    KIE_API_KEY: "test-kie-key",
    KIE_API_BASE_URL: "https://api.kie.ai",
    ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: "test-gemini-key",
    NODE_ENV: "test",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/anthropic.js", () => ({ getAnthropicClient: () => ({}) }))
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent, generateContentStream: vi.fn() }
    files = { upload: vi.fn(), get: vi.fn() }
  },
  ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
}))
vi.mock("@/lib/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-fetch.js")>()),
  safeFetch: mocks.safeFetch,
}))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: mocks.maybeProxyLlmRouteToCloud }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: mocks.commitReservedCreditsForJob,
  refundReservedCreditsForJob: mocks.refundReservedCreditsForJob,
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("@/lib/supabase.js", () => {
  // .update({...}).eq("id", …).eq("user_id", …) — the exact chain the route uses.
  const second = vi.fn().mockResolvedValue({ data: null, error: null })
  const first = vi.fn(() => ({ eq: second }))
  return {
    supabase: {
      from: vi.fn(() => ({
        update: (row: Record<string, unknown>) => {
          mocks.jobUpdate(row)
          return { eq: first }
        },
      })),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    },
  }
})

import { describeToPickerRoutes } from "../describe-to-picker.js"
import { KIE_INLINE_DATA_URL_MAX_CHARS } from "@/lib/kie-inline-image.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const IMAGE_URL = "https://cdn.example/images/portrait.png"
const KIE_URL = "https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions"
const ANSWER = { person: { age: "age-30s" } }

/** The analyzer's answer, as KIE's chat-completions returns it. */
function kieAnswer(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify(ANSWER) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1200, completion_tokens: 40 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}

/** KIE's answer to an image URL on 2026-10-09: a service-error envelope. */
function kieNetworkError(): Response {
  return new Response(JSON.stringify({ code: 500, msg: "Network error, please try again later." }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

/** The one request KIE received: where it went, its raw body, and the image part's URL. */
function kieRequest(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
  const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: unknown }> }
  const user = body.messages.find((m) => m.role === "user")
  const image = (user?.content as Array<Record<string, unknown>>).find((p) => p.type === "image_url")
  return { url: String(url), raw: init.body, imageUrl: (image?.image_url as { url: string }).url }
}

const servedAs = (bytes: Buffer, contentType: string) => async () =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } })

describe("POST /v1/describe-to-picker — Gemini on KIE gets every image inline", () => {
  let app: FastifyInstance
  let fetchMock: ReturnType<typeof vi.fn>
  let png: Buffer

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
    mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
    mocks.refundReservedCreditsForJob.mockResolvedValue(0)
    mocks.markProviderCallStart.mockResolvedValue(undefined)

    png = await sharp({ create: { width: 96, height: 96, channels: 3, background: "#a07050" } }).png().toBuffer()
    mocks.safeFetch.mockImplementation(servedAs(png, "image/png"))
    fetchMock = vi.fn().mockImplementation(async () => kieAnswer())
    vi.stubGlobal("fetch", fetchMock)

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await describeToPickerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const post = (imageUrl: string) =>
    app.inject({
      method: "POST",
      url: "/v1/describe-to-picker",
      payload: { imageUrl, targetPickers: ["person"], llmModel: "gemini-3.8-flash", userId: USER_ID },
    })

  /** The completed job row as the route wrote it. */
  function completedRow(): Record<string, unknown> {
    const completed = mocks.jobUpdate.mock.calls.map(([row]) => row as Record<string, unknown>).find((row) => row.status === "completed")
    expect(completed).toBeDefined()
    return completed as Record<string, unknown>
  }

  it("sends a small image's bytes inline, completes, and records that KIE served it", async () => {
    const res = await post(IMAGE_URL)

    expect(res.statusCode).toBe(200)
    expect(res.json().pickerJson).toEqual(ANSWER)
    const request = kieRequest(fetchMock)
    expect(request.url).toBe(KIE_URL)
    expect(request.imageUrl).toBe(`data:image/png;base64,${png.toString("base64")}`)
    expect(request.raw).not.toContain(IMAGE_URL)
    // The serving lane goes to the admin-only provider column; the owner-visible
    // output_data carries the usage exactly as before, with no lane in it.
    expect(completedRow().provider).toBe("kie")
    expect((completedRow().output_data as { usage: unknown }).usage).toEqual({ inputTokens: 1200, outputTokens: 40 })
    expect(JSON.stringify(res.json())).not.toContain("kie")
  })

  it("sends a 2 MB PNG on our own CDN as a resized JPEG data URL within the limit — never its URL", async () => {
    // Full-range noise does not compress: about 2 MB, kept verbatim by the
    // prefetch, and a data URL past KIE's inline limit.
    const twoMb = await sharp(randomBytes(820 * 820 * 3), { raw: { width: 820, height: 820, channels: 3 } }).png().toBuffer()
    expect(twoMb.byteLength).toBeGreaterThan(2_000_000)
    mocks.safeFetch.mockImplementation(servedAs(twoMb, "image/png"))

    const res = await post(IMAGE_URL)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(request.imageUrl.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(request.imageUrl.length).toBeLessThanOrEqual(KIE_INLINE_DATA_URL_MAX_CHARS)
    expect(request.raw).not.toContain(IMAGE_URL)
  })

  it("sends a large PNG as the prefetch's downscaled JPEG, inline", async () => {
    // Low-amplitude grain: past the 3.5 MB budget as a PNG, a small JPEG once
    // the prefetch downscales it.
    const w = 1800
    const grain = randomBytes(w * w * 3)
    for (let i = 0; i < grain.length; i++) grain[i] = 122 + (grain[i] % 13)
    const large = await sharp(grain, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer()
    expect(large.byteLength).toBeGreaterThan(3_500_000)
    mocks.safeFetch.mockImplementation(servedAs(large, "image/png"))

    const res = await post(IMAGE_URL)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(request.imageUrl.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(request.raw).not.toContain(IMAGE_URL)
  })

  it("sends an image converted from another format as its JPEG", async () => {
    const tiff = await sharp({ create: { width: 96, height: 96, channels: 3, background: "#a07050" } }).tiff().toBuffer()
    mocks.safeFetch.mockImplementation(servedAs(tiff, "image/tiff"))
    const tiffUrl = "https://cdn.example/uploads/scan.tiff"

    const res = await post(tiffUrl)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(request.imageUrl.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(request.raw).not.toContain(tiffUrl)
  })

  it("never hands KIE a self-host storage URL either", async () => {
    vi.stubEnv("R2_PUBLIC_URL", "http://localhost:3000/storage/nodaro-assets")
    const selfHosted = "http://localhost:3000/storage/nodaro-assets/images/portrait.png"

    const res = await post(selfHosted)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(request.imageUrl).toBe(`data:image/png;base64,${png.toString("base64")}`)
    expect(request.raw).not.toContain(selfHosted)
  })

  it("records the direct Gemini lane when KIE fails, and that lane gets the ORIGINAL prefetched bytes", async () => {
    // About 2 MB: KIE's leg resizes it; the direct lane must get the PNG as prefetched.
    const twoMb = await sharp(randomBytes(820 * 820 * 3), { raw: { width: 820, height: 820, channels: 3 } }).png().toBuffer()
    mocks.safeFetch.mockImplementation(servedAs(twoMb, "image/png"))
    fetchMock.mockImplementation(async () => kieNetworkError())
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(ANSWER),
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 30 },
    })

    const res = await post(IMAGE_URL)

    expect(res.statusCode).toBe(200)
    expect(res.json().pickerJson).toEqual(ANSWER)
    expect(mocks.generateContent).toHaveBeenCalled()
    expect(completedRow().provider).toBe("direct-gemini")
    expect(JSON.stringify(completedRow().output_data)).not.toContain("direct-gemini")
    // KIE's leg went inline and resized; the direct lane got the original bytes.
    expect(String(fetchMock.mock.calls[0]?.[1] && (fetchMock.mock.calls[0][1] as { body: string }).body)).toContain("data:image/jpeg;base64,")
    const sentToGoogle = JSON.stringify(mocks.generateContent.mock.calls[0]?.[0])
    expect(sentToGoogle).toContain(twoMb.toString("base64"))
    expect(sentToGoogle).toContain("image/png")
  })
})
