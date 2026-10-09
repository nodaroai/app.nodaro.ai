/**
 * Describe to Picker on a Gemini model served by KIE, end to end through the
 * real prefetch and the real LLM client — only the network edges are stubbed.
 *
 * A 2 MB PNG on our own media host used to reach KIE as a `data:` URL, which
 * KIE refuses past a size it does not document ("Inline data URL is too large.
 * Upload the file and pass an HTTP(S) URL instead."), failing the analysis
 * outright. An image on our host now reaches KIE by its https URL, which KIE
 * fetches itself; a small one from any other host still travels inline.
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

const USER_ID = "00000000-0000-4000-8000-000000000001"
/** Our media host (R2_PUBLIC_URL, stubbed per test). */
const OWN_ORIGIN = "https://cdn.example"
const IMAGE_URL = `${OWN_ORIGIN}/images/portrait.png`
const KIE_URL = "https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions"

/** The analyzer's answer, as KIE's chat-completions returns it. */
function kieAnswer(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify({ person: { age: "age-30s" } }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1200, completion_tokens: 40 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}

/** The one request KIE received: where it went, its raw body, and the image part. */
function kieRequest(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }]
  const body = JSON.parse(init.body) as { messages: Array<{ role: string; content: unknown }> }
  const user = body.messages.find((m) => m.role === "user")
  const image = (user?.content as Array<Record<string, unknown>>).find((p) => p.type === "image_url")
  return { url: String(url), raw: init.body, image }
}

describe("POST /v1/describe-to-picker — Gemini on KIE gets the image by URL", () => {
  let app: FastifyInstance
  let fetchMock: ReturnType<typeof vi.fn>
  let png: Buffer

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv("R2_PUBLIC_URL", OWN_ORIGIN)
    vi.stubEnv("R2_PUBLIC_FALLBACK_DOMAIN", "")
    mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
    mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
    mocks.refundReservedCreditsForJob.mockResolvedValue(0)
    mocks.markProviderCallStart.mockResolvedValue(undefined)

    png = await sharp({ create: { width: 96, height: 96, channels: 3, background: "#a07050" } }).png().toBuffer()
    mocks.safeFetch.mockImplementation(async () =>
      new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }),
    )
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
  })

  const post = (imageUrl: string) =>
    app.inject({
      method: "POST",
      url: "/v1/describe-to-picker",
      payload: { imageUrl, targetPickers: ["person"], llmModel: "gemini-3.8-flash", userId: USER_ID },
    })

  it("sends an image on our media host to KIE by URL, not the prefetched bytes, and the analysis completes", async () => {
    const res = await post(IMAGE_URL)

    expect(res.statusCode).toBe(200)
    expect(res.json().pickerJson).toEqual({ person: { age: "age-30s" } })
    // The real prefetch ran (the Anthropic lanes still need those bytes)...
    expect(mocks.safeFetch).toHaveBeenCalledWith(IMAGE_URL, expect.anything())
    // ...and KIE was handed the URL instead.
    const request = kieRequest(fetchMock)
    expect(request.url).toBe(KIE_URL)
    expect(request.image).toEqual({ type: "image_url", image_url: { url: IMAGE_URL } })
    expect(request.raw).not.toContain("data:")
    expect(request.raw).not.toContain(png.toString("base64"))
    expect(mocks.refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("sends the 2 MB verbatim PNG on our host by URL", async () => {
    // Full-range noise does not compress: about 2 MB, so the prefetch keeps it
    // verbatim, and its data URL is past KIE's inline limit.
    const twoMb = await sharp(randomBytes(820 * 820 * 3), { raw: { width: 820, height: 820, channels: 3 } }).png().toBuffer()
    expect(twoMb.byteLength).toBeGreaterThan(2_000_000)
    expect(twoMb.byteLength).toBeLessThanOrEqual(3_500_000)
    mocks.safeFetch.mockImplementation(async () =>
      new Response(new Uint8Array(twoMb), { status: 200, headers: { "content-type": "image/png" } }),
    )

    const res = await post(IMAGE_URL)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(request.image).toEqual({ type: "image_url", image_url: { url: IMAGE_URL } })
    expect(request.raw).not.toContain("data:")
  })

  it("sends a large PNG on our host inline as its downscaled JPEG, not the full original", async () => {
    // Low-amplitude grain: past the 3.5 MB budget as a PNG, a small JPEG once
    // downscaled — the resized copy, not the original KIE would have to fetch.
    const w = 1800
    const grain = randomBytes(w * w * 3)
    for (let i = 0; i < grain.length; i++) grain[i] = 122 + (grain[i] % 13)
    const large = await sharp(grain, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer()
    expect(large.byteLength).toBeGreaterThan(3_500_000)
    mocks.safeFetch.mockImplementation(async () =>
      new Response(new Uint8Array(large), { status: 200, headers: { "content-type": "image/png" } }),
    )

    const res = await post(IMAGE_URL)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(String((request.image?.image_url as { url: string }).url)).toMatch(/^data:image\/jpeg;base64,/)
    expect(request.raw).not.toContain(IMAGE_URL)
  })

  it("keeps a small image from another host inline", async () => {
    const elsewhere = "https://images.elsewhere.example/portrait.png"

    const res = await post(elsewhere)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(request.image).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
    })
    expect(request.raw).not.toContain(elsewhere)
  })

  it("never hands KIE a self-host storage URL — that image travels as bytes", async () => {
    // A self-host install serves its bucket through the app origin; the route
    // accepts that URL and this server fetches it, but KIE never could.
    vi.stubEnv("R2_PUBLIC_URL", "http://localhost:3000/storage/nodaro-assets")
    const selfHosted = "http://localhost:3000/storage/nodaro-assets/images/portrait.png"

    const res = await post(selfHosted)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(request.image).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
    })
    expect(request.raw).not.toContain(selfHosted)
  })

  it("sends an image converted from another format as its JPEG, never the original's URL", async () => {
    // A TIFF upload is converted (and downscaled) for the Anthropic lanes; its
    // own URL would hand KIE a format it may not read.
    const tiff = await sharp({ create: { width: 96, height: 96, channels: 3, background: "#a07050" } }).tiff().toBuffer()
    mocks.safeFetch.mockImplementation(async () =>
      new Response(new Uint8Array(tiff), { status: 200, headers: { "content-type": "image/tiff" } }),
    )
    const tiffUrl = "https://cdn.example/uploads/scan.tiff"

    const res = await post(tiffUrl)

    expect(res.statusCode).toBe(200)
    const request = kieRequest(fetchMock)
    expect(String((request.image?.image_url as { url: string }).url)).toMatch(/^data:image\/jpeg;base64,/)
    expect(request.raw).not.toContain(tiffUrl)
  })
})
