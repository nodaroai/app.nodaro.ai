import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }),
      },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue({ id: "queue-job-1" }) },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "log-1", creditsReserved: 5, watermark: false }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  const safeUrlSchema = z
    .string()
    .url()
    .refine((url) => {
      try {
        const { protocol } = new URL(url)
        return protocol === "http:" || protocol === "https:"
      } catch {
        return false
      }
    })
  return { safeUrlSchema }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateSurroundContinuationRoutes } from "../generate-surround-continuation.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000077"
const REF_URL = "https://r2.example/prev-view.png"

let app: FastifyInstance

function mockLocationOwned(owned: boolean) {
  const locSingle = vi.fn().mockResolvedValue({ data: owned ? { id: TEST_LOCATION_ID } : null, error: null })
  const locIs = vi.fn().mockReturnValue({ single: locSingle })
  const locEqUser = vi.fn().mockReturnValue({ is: locIs })
  const locEqId = vi.fn().mockReturnValue({ eq: locEqUser })
  const locSelect = vi.fn().mockReturnValue({ eq: locEqId })
  const jobSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const jobInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: jobSingle }) })
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "jobs") return { insert: jobInsert } as never
    if (table === "locations") return { select: locSelect } as never
    return {} as never
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(reserveCreditsForJob).mockResolvedValue({ usageLogId: "log-1", creditsReserved: 5, watermark: false } as never)
  mockLocationOwned(true)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateSurroundContinuationRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/generate-surround-continuation", () => {
  it("queues the job, defaults carriedFraction to 0.5, and forwards the surround params", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        referenceImageUrl: REF_URL,
        direction: "right",
        degrees: 45,
        provider: "nano-banana-pro",
        aspectRatio: "16:9",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "angles",
        attachName: "Surround 45°",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const [jobName, payload] = vi.mocked(videoQueue.add).mock.calls[0] as [string, Record<string, unknown>]
    expect(jobName).toBe("generate-surround-continuation")
    expect(payload).toMatchObject({
      referenceImageUrl: REF_URL,
      direction: "right",
      degrees: 45,
      carriedFraction: 0.5,
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      attachToLocationId: TEST_LOCATION_ID,
      attachToColumn: "angles",
      attachName: "Surround 45°",
    })
  })

  it("builds a fill prompt that pins the carried edge and forbids the golden-hour drift", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "right", userPrompt: "a windswept coastal cliff" },
    })
    const payload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    const prompt = String(payload.prompt)
    expect(prompt).toContain("a windswept coastal cliff") // scene hint woven in
    expect(prompt.toLowerCase()).toContain("left") // carried edge for "right"
    expect(prompt.toLowerCase()).toContain("golden hour") // anti-drift negative
  })

  it("builds a tilt-aware prompt for up/down (render sky, NOT a landscape continuation)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "up" },
    })
    const prompt = String((vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>).prompt).toLowerCase()
    expect(prompt).toContain("tilted straight up")
    expect(prompt).toContain("sky")
    expect(prompt).toContain("do not repeat, mirror, or continue the landscape")
    expect(prompt).not.toContain("seamless continuation of the") // the pan-only phrasing
  })

  it("reserves credits keyed on the image provider", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "up", provider: "nano-banana-pro" },
    })
    expect(reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "nano-banana-pro")
  })

  it("works without an attach target (no location read) and still enqueues", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "right" },
    })
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(payload.direction).toBe("right")
    expect(payload.carriedFraction).toBe(0.5) // pan default
  })

  it("accepts the new 'left' pan direction", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "left" },
    })
    expect(res.statusCode).toBe(200)
    const payload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(payload.direction).toBe("left")
    expect(payload.carriedFraction).toBe(0.5) // pan default
  })

  it("resolves the thin carried fraction (0.12) for tilts when not pinned", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "up" },
    })
    const payload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(payload.direction).toBe("up")
    expect(payload.carriedFraction).toBe(0.12)
  })

  it("forwards refine + refineProvider to the worker (default false / recraft)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "right", refine: true, refineProvider: "topaz-image-upscale" },
    })
    let payload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(payload.refine).toBe(true)
    expect(payload.refineProvider).toBe("topaz-image-upscale")

    vi.mocked(videoQueue.add).mockClear()
    await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "right" },
    })
    payload = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(payload.refine).toBe(false)
    expect(payload.refineProvider).toBe("recraft-upscale")
  })

  it("rejects an unknown refineProvider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "right", refine: true, refineProvider: "topaz" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("404s and does not enqueue when attachToLocationId resolves to no owned row", async () => {
    mockLocationOwned(false)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "right", attachToLocationId: TEST_LOCATION_ID, attachToColumn: "angles", attachName: "Surround 45°" },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("rejects an invalid direction with validation_error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "forward" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("rejects a missing referenceImageUrl", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { direction: "right" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("rejects a carriedFraction outside [0.1, 0.9]", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-surround-continuation",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { referenceImageUrl: REF_URL, direction: "right", carriedFraction: 0.95 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
