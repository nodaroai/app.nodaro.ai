import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { captionLocation } from "../../lib/location-caption.js"
import { meterSyncLlm } from "../../lib/meter-sync-llm.js"
import { locationLlmCaptionRoutes } from "../location-llm-caption.js"

// captionLocation is mocked at the helper boundary — the route only sees the
// helper's resolved `string | null`.
vi.mock("../../lib/location-caption.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/location-caption.js")>(
    "../../lib/location-caption.js",
  )
  return {
    ...actual,
    captionLocation: vi.fn(),
  }
})
vi.mock("../../lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// Credit machinery tested elsewhere; no-op the guard + stub the meter here.
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../lib/meter-sync-llm.js", () => ({ meterSyncLlm: vi.fn() }))
// CI has no .env so config.ANTHROPIC_API_KEY / KIE_API_KEY would be empty,
// tripping the 503 provider_unavailable preflight. Mock as truthy.
vi.mock("../../lib/config.js", () => ({
  config: { ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "test-key" },
}))

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000020"
const SOURCE_IMAGE_URL = "https://r2.example.com/location-source.jpg"
const SAMPLE_CAPTION =
  "A windswept clifftop temple at dawn, pale limestone columns weathered by salt air. " +
  "Wide stone steps lead to a central altar carved with vine motifs. Soft amber light from the rising sun bathes the eastern face."

let app: FastifyInstance
let meter: { jobId: string; usageLogId?: string; commit: ReturnType<typeof vi.fn>; refund: ReturnType<typeof vi.fn> }

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(captionLocation).mockResolvedValue(SAMPLE_CAPTION)
  meter = { jobId: "job-1", usageLogId: "ul-1", commit: vi.fn().mockResolvedValue(undefined), refund: vi.fn().mockResolvedValue(undefined) }
  vi.mocked(meterSyncLlm).mockResolvedValue(meter as never)
  app = Fastify({ logger: false })
  // Simulate auth middleware: set req.userId from X-User-Id header (matches
  // location-restore.test.ts pattern).
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => {
    await locationLlmCaptionRoutes(i)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Mock builders — keep route-table chain shapes co-located.
// ---------------------------------------------------------------------------

// .from("locations").select("id, source_image_url").eq("id", ..).eq("user_id", ..).is("deleted_at", null).single()
function mockLocationFetch(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const is = vi.fn().mockReturnValue({ single })
  const eq2 = vi.fn().mockReturnValue({ is })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, eq1, eq2, is, single }
}

// .from("locations").update(..).eq("id", ..).eq("user_id", ..)
function mockLocationUpdate(result: { error: unknown }) {
  // The update chain in the route resolves at `.eq("user_id", ...)` because
  // the route doesn't call .select() afterward — it just awaits the update.
  const eq2 = vi.fn().mockResolvedValue(result)
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const update = vi.fn().mockReturnValue({ eq: eq1 })
  return { update, eq1, eq2 }
}

function wireSupabase(parts: {
  locationFetch?: ReturnType<typeof mockLocationFetch>
  locationUpdate?: ReturnType<typeof mockLocationUpdate>
}) {
  let locCall = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "locations") {
      locCall++
      if (locCall === 1) {
        if (!parts.locationFetch) throw new Error("test forgot to set locationFetch")
        return { select: parts.locationFetch.select } as never
      }
      if (!parts.locationUpdate) throw new Error("test forgot to set locationUpdate")
      return { update: parts.locationUpdate.update } as never
    }
    throw new Error(`unexpected table ${table}`)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/locations/:id/llm-caption", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/llm-caption`,
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 on invalid id param", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/not-a-uuid/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 when location is archived or cross-user (deleted_at IS NULL filter rejects)", async () => {
    const locationFetch = mockLocationFetch({ data: null, error: { code: "PGRST116" } })
    wireSupabase({ locationFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("location_not_found")
    expect(vi.mocked(captionLocation)).not.toHaveBeenCalled()
    // Verify the fetch enforced ownership + not-deleted.
    expect(locationFetch.eq1).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(locationFetch.eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(locationFetch.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 400 when source_image_url is null (nothing to caption)", async () => {
    const locationFetch = mockLocationFetch({
      data: { id: TEST_LOCATION_ID, source_image_url: null },
      error: null,
    })
    wireSupabase({ locationFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("no_source_image")
    expect(vi.mocked(captionLocation)).not.toHaveBeenCalled()
  })

  it("returns 502 when LLM caption fails (FATAL — differs from approve-main-image)", async () => {
    // captionLocation() returns null on any LLM failure. This route — unlike
    // approve-main-image — treats null as FATAL because the frontend uses it
    // to RETRY a failed caption. There is no other side-effect to preserve.
    vi.mocked(captionLocation).mockResolvedValueOnce(null)
    const locationFetch = mockLocationFetch({
      data: { id: TEST_LOCATION_ID, source_image_url: SOURCE_IMAGE_URL },
      error: null,
    })
    const locationUpdate = mockLocationUpdate({ error: null })
    wireSupabase({ locationFetch, locationUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("caption_failed")
    // Critical contract: NO UPDATE was issued on caption failure.
    expect(locationUpdate.update).not.toHaveBeenCalled()
    expect(meter.refund).toHaveBeenCalled()
    expect(meter.commit).not.toHaveBeenCalled()
  })

  it("returns 200 with { canonicalDescription } on success", async () => {
    const locationFetch = mockLocationFetch({
      data: { id: TEST_LOCATION_ID, source_image_url: SOURCE_IMAGE_URL },
      error: null,
    })
    const locationUpdate = mockLocationUpdate({ error: null })
    wireSupabase({ locationFetch, locationUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ canonicalDescription: SAMPLE_CAPTION })
    // UPDATE must touch canonical_description + updated_at only (NOT source_image_url).
    expect(locationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical_description: SAMPLE_CAPTION,
      }),
    )
    const updateCallArg = locationUpdate.update.mock.calls[0][0] as Record<string, unknown>
    expect(updateCallArg).not.toHaveProperty("source_image_url")
    expect(updateCallArg).toHaveProperty("updated_at")
    // Verify caption helper was invoked with the location's source image url.
    expect(vi.mocked(captionLocation)).toHaveBeenCalledWith(SOURCE_IMAGE_URL)
    expect(meter.commit).toHaveBeenCalled()
    expect(meter.refund).not.toHaveBeenCalled()
  })

  it("returns 500 when persist UPDATE fails", async () => {
    const locationFetch = mockLocationFetch({
      data: { id: TEST_LOCATION_ID, source_image_url: SOURCE_IMAGE_URL },
      error: null,
    })
    const locationUpdate = mockLocationUpdate({ error: { message: "DB write failed" } })
    wireSupabase({ locationFetch, locationUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/llm-caption`,
      headers: { "x-user-id": TEST_USER_ID },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("update_failed")
    expect(meter.refund).toHaveBeenCalled()
    expect(meter.commit).not.toHaveBeenCalled()
  })
})
