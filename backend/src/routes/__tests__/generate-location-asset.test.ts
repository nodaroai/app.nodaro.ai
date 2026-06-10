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
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    },
  }
})

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
  },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn().mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 2,
    watermark: false,
  }),
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
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

import { generateLocationAssetRoutes } from "../generate-location-asset.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000077"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(reserveCreditsForJob).mockResolvedValue({
    usageLogId: "log-1",
    creditsReserved: 2,
    watermark: false,
  } as never)

  const jobSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  // Location ownership/source-image lookup for the approved-source-image gate
  // (parity with character/object). The attach-param test below sets
  // attachToLocationId, so the gate now fetches the row — return one with an
  // approved source_image_url so the gate passes and the job still enqueues.
  const locSingle = vi.fn().mockResolvedValue({
    data: {
      source_image_url: "https://r2.example/anchor.png",
      name: "Hidden Lagoon",
      canonical_description: "a turquoise lagoon ringed by limestone cliffs",
    },
    error: null,
  })
  const locIs = vi.fn().mockReturnValue({ single: locSingle })
  const locEqUser = vi.fn().mockReturnValue({ is: locIs })
  const locEqId = vi.fn().mockReturnValue({ eq: locEqUser })
  const locSelect = vi.fn().mockReturnValue({ eq: locEqId })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "jobs") return { insert: jobInsert } as never
    if (table === "locations") return { select: locSelect } as never
    return {} as never
  })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateLocationAssetRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-location-asset — extended asset types (Task 9)", () => {
  it("accepts assetType=seasons + variant=winter and queues the job", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "seasons",
        variant: "winter",
        name: "Forest Glade",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.assetType).toBe("seasons")
    expect(enqueued.variant).toBe("winter")
    // Prompt should reference the season variant.
    expect(String(enqueued.prompt).toLowerCase()).toContain("winter")
  })

  it("accepts assetType=lighting + variant=neon and queues the job", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "lighting",
        variant: "neon",
        name: "Alley",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.assetType).toBe("lighting")
    expect(enqueued.variant).toBe("neon")
    expect(String(enqueued.prompt).toLowerCase()).toContain("neon")
  })

  it("custom assetType uses userPrompt (not the literal variant) in the prompt", async () => {
    // GAP 48 — when assetType=custom and userPrompt is supplied (typically
    // the long free-form text from the studio UI), the prompt builder MUST
    // honor userPrompt over the short variant string (e.g. "custom").
    const longUserPrompt =
      "an abandoned victorian greenhouse overrun with ivy and moonflowers, " +
      "shafts of moonlight piercing the broken glass roof, mist curling " +
      "around iron statues, fairy lights tangled in vines"
    expect(longUserPrompt.length).toBeGreaterThan(100)

    await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "custom",
        variant: "custom", // literal — what the studio UI sends for custom assets
        name: "Greenhouse",
        userPrompt: longUserPrompt,
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(String(enqueued.prompt)).toContain("abandoned victorian greenhouse")
    expect(String(enqueued.prompt)).toContain("moonflowers")
  })

  it("passes attach params through to the worker job payload", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "lighting",
        variant: "neon",
        name: "Alley",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "lighting",
        attachName: "neon",
      },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-location-asset",
      expect.objectContaining({
        jobId: "job-1",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "lighting",
        attachName: "neon",
      }),
    )
  })

  it("anchors studio-path generations: row source image, name, and canonical description flow into the job", async () => {
    // Regression — the gate used to read the row and then DISCARD it: the
    // worker received sourceImageUrl=undefined (no i2i reference) and the
    // prompt said "Untitled location", so assets came back as unrelated
    // landscapes. When attaching, the row anchors identity.
    await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "timeOfDay",
        variant: "golden hour",
        name: "Untitled location",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "time_of_day",
        attachName: "golden hour",
      },
    })

    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.sourceImageUrl).toBe("https://r2.example/anchor.png")
    expect(String(enqueued.prompt)).toContain("Hidden Lagoon")
    expect(String(enqueued.prompt)).toContain("a turquoise lagoon ringed by limestone cliffs")
    expect(String(enqueued.prompt)).not.toContain("Untitled location")
  })

  it("an explicit caller sourceImageUrl wins over the row anchor (chained generations)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "custom",
        variant: "custom",
        name: "Hidden Lagoon",
        userPrompt: "rotate the camera 45 degrees right",
        sourceImageUrl: "https://r2.example/previous-view.png",
        aspectRatio: "16:9",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "angles",
        attachName: "Pan 45",
      },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.sourceImageUrl).toBe("https://r2.example/previous-view.png")
    // The framing override rides into the worker payload (the studio's 360°
    // surround path pins 16:9); absent = undefined (model default).
    expect(enqueued.aspectRatio).toBe("16:9")
  })

  it("rejects an aspectRatio outside the shared enum", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "seasons",
        variant: "winter",
        name: "Forest Glade",
        aspectRatio: "21:9",
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("non-attach calls keep sourceImageUrl undefined (no row read, no anchor)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { assetType: "seasons", variant: "winter", name: "Forest Glade" },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.sourceImageUrl).toBeUndefined()
    expect(String(enqueued.prompt)).toContain("Forest Glade")
  })

  it("404s and does not enqueue when attachToLocationId resolves to no owned row", async () => {
    // Approved-source-image gate parity: a forged/cross-user/deleted location
    // id yields no row → 404, before any credit reservation or enqueue.
    const locSingle = vi.fn().mockResolvedValue({ data: null, error: null })
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

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "lighting",
        variant: "neon",
        name: "Alley",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "lighting",
        attachName: "neon",
      },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("400s main_image_required and does not enqueue when the location has no approved source image", async () => {
    const locSingle = vi.fn().mockResolvedValue({ data: { source_image_url: null }, error: null })
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

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "lighting",
        variant: "neon",
        name: "Alley",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "lighting",
        attachName: "neon",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("main_image_required")
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("rejects invalid variant for seasons with validation_error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "seasons",
        variant: "monsoon", // not in the season list
        name: "Forest",
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("still accepts the legacy variants (timeOfDay=dawn, weather=clear, angles=wide)", async () => {
    // Regression guard — Task 9 must not shrink the existing variant sets.
    for (const [assetType, variant] of [
      ["timeOfDay", "dawn"],
      ["weather", "clear"],
      ["angles", "wide"],
    ] as const) {
      vi.mocked(videoQueue.add).mockClear()
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-location-asset",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { assetType, variant, name: "X" },
      })
      expect(res.statusCode).toBe(200)
      expect(videoQueue.add).toHaveBeenCalledTimes(1)
    }
  })

  it("returns 400 for assetType not in the shared LOCATION_ASSET_TYPES enum", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "bogus",
        variant: "x",
        name: "Y",
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for attachToColumn not in LOCATION_ATTACH_COLUMNS", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-location-asset",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        assetType: "lighting",
        variant: "neon",
        name: "Alley",
        attachToLocationId: TEST_LOCATION_ID,
        attachToColumn: "bogus_column",
        attachName: "neon",
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})
