import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { captionLocation } from "../../lib/location-caption.js"
import { locationMainImageApprovalRoutes } from "../location-main-image-approval.js"

// captionLocation is mocked at the helper boundary — the route only sees the
// helper's resolved `string | null`. Tests for the helper's own behaviour
// (truncation, error swallow) hit the real implementation in this file too.
vi.mock("../../lib/location-caption.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/location-caption.js")>(
    "../../lib/location-caption.js",
  )
  return {
    ...actual,
    captionLocation: vi.fn(),
  }
})
// The helper imports llmComplete — mock it too so the truncation test can
// stub a 5000-char response without going through KIE/Anthropic.
vi.mock("../../lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// CI has no .env so config.ANTHROPIC_API_KEY / KIE_API_KEY would be empty,
// tripping the 503 provider_unavailable preflight. Mock as truthy.
vi.mock("../../lib/config.js", () => ({
  config: { ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "test-key" },
}))

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_LOCATION_ID = "00000000-0000-4000-8000-000000000020"
const TEST_JOB_ID = "00000000-0000-4000-8000-000000000030"
const IMAGE_URL = "https://r2.example.com/location-candidate.jpg"
const SAMPLE_CAPTION =
  "A windswept clifftop temple at dawn, pale limestone columns weathered by salt air. " +
  "Wide stone steps lead to a central altar carved with vine motifs. Soft amber light from the rising sun bathes the eastern face."

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(captionLocation).mockResolvedValue(SAMPLE_CAPTION)
  app = Fastify({ logger: false })
  // Simulate auth middleware: set req.userId from X-User-Id header (matches
  // location-restore.test.ts pattern).
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => {
    await locationMainImageApprovalRoutes(i)
  })
  await app.ready()
})
afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Mock builders — keep route-table chain shapes co-located.
// ---------------------------------------------------------------------------

// .from("jobs").select(..).eq("id", ..).eq("user_id", ..).single()
function mockJobFetch(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const eq2 = vi.fn().mockReturnValue({ single })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, eq1, eq2, single }
}

// .from("locations").select("id").eq("id", ..).eq("user_id", ..).is("deleted_at", null).single()
function mockLocationPreFetch(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const is = vi.fn().mockReturnValue({ single })
  const eq2 = vi.fn().mockReturnValue({ is })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, eq1, eq2, is, single }
}

// .from("locations").update(..).eq("id", ..).eq("user_id", ..).select(..).single()
function mockLocationUpdate(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const selectAfter = vi.fn().mockReturnValue({ single })
  const eq2 = vi.fn().mockReturnValue({ select: selectAfter })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const update = vi.fn().mockReturnValue({ eq: eq1 })
  return { update, eq1, eq2, selectAfter, single }
}

function wireSupabase(parts: {
  jobs?: ReturnType<typeof mockJobFetch>
  locationPreFetch?: ReturnType<typeof mockLocationPreFetch>
  locationUpdate?: ReturnType<typeof mockLocationUpdate>
}) {
  let locCall = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "jobs") {
      if (!parts.jobs) throw new Error("test forgot to set jobs mock")
      return { select: parts.jobs.select } as never
    }
    if (table === "locations") {
      locCall++
      if (locCall === 1) {
        // First locations call = pre-fetch
        if (!parts.locationPreFetch) throw new Error("test forgot to set locationPreFetch")
        return { select: parts.locationPreFetch.select } as never
      }
      // Second locations call = update
      if (!parts.locationUpdate) throw new Error("test forgot to set locationUpdate")
      return { update: parts.locationUpdate.update } as never
    }
    throw new Error(`unexpected table ${table}`)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/locations/:id/approve-main-image", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 on invalid id param", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/not-a-uuid/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 on invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: "not-a-uuid" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 when candidate job not found (cross-user)", async () => {
    // Route scopes the candidate lookup by user_id, so a cross-user
    // candidateJobId returns no row. Location pre-fetch runs in parallel
    // but the candidate failure short-circuits BEFORE any LLM call / UPDATE.
    const jobs = mockJobFetch({ data: null, error: { code: "PGRST116" } })
    const locationPreFetch = mockLocationPreFetch({ data: { id: TEST_LOCATION_ID }, error: null })
    wireSupabase({ jobs, locationPreFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("candidate_job_not_found")
    expect(jobs.eq1).toHaveBeenCalledWith("id", TEST_JOB_ID)
    expect(jobs.eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(vi.mocked(captionLocation)).not.toHaveBeenCalled()
  })

  it("returns 400 when candidate job is not in completed state", async () => {
    const jobs = mockJobFetch({
      data: { id: TEST_JOB_ID, status: "running", output_data: null },
      error: null,
    })
    const locationPreFetch = mockLocationPreFetch({ data: { id: TEST_LOCATION_ID }, error: null })
    wireSupabase({ jobs, locationPreFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("candidate_not_completed")
    expect(vi.mocked(captionLocation)).not.toHaveBeenCalled()
  })

  it("returns 400 when candidate has no imageUrl in output", async () => {
    const jobs = mockJobFetch({
      data: { id: TEST_JOB_ID, status: "completed", output_data: {} },
      error: null,
    })
    const locationPreFetch = mockLocationPreFetch({ data: { id: TEST_LOCATION_ID }, error: null })
    wireSupabase({ jobs, locationPreFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("candidate_no_image")
  })

  it("returns 404 when location is archived (deleted_at IS NULL filter rejects)", async () => {
    // Archived rows have deleted_at != null. The pre-fetch's
    // `.is("deleted_at", null)` returns no row → 404.
    const jobs = mockJobFetch({
      data: { id: TEST_JOB_ID, status: "completed", output_data: { imageUrl: IMAGE_URL } },
      error: null,
    })
    const locationPreFetch = mockLocationPreFetch({ data: null, error: { code: "PGRST116" } })
    const locationUpdate = mockLocationUpdate({ data: null, error: null })
    wireSupabase({ jobs, locationPreFetch, locationUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("location_not_found")
    expect(vi.mocked(captionLocation)).not.toHaveBeenCalled()
    expect(locationUpdate.update).not.toHaveBeenCalled()
    // Verify the pre-fetch enforced ownership + not-deleted.
    expect(locationPreFetch.eq1).toHaveBeenCalledWith("id", TEST_LOCATION_ID)
    expect(locationPreFetch.eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(locationPreFetch.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 200 with { sourceImageUrl, canonicalDescription } on success", async () => {
    const jobs = mockJobFetch({
      data: { id: TEST_JOB_ID, status: "completed", output_data: { imageUrl: IMAGE_URL } },
      error: null,
    })
    const locationPreFetch = mockLocationPreFetch({ data: { id: TEST_LOCATION_ID }, error: null })
    const locationUpdate = mockLocationUpdate({
      data: { source_image_url: IMAGE_URL, canonical_description: SAMPLE_CAPTION },
      error: null,
    })
    wireSupabase({ jobs, locationPreFetch, locationUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      sourceImageUrl: IMAGE_URL,
      canonicalDescription: SAMPLE_CAPTION,
    })
    // UPDATE row must include both new fields.
    expect(locationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        source_image_url: IMAGE_URL,
        canonical_description: SAMPLE_CAPTION,
      }),
    )
  })

  it("returns 200 with canonicalDescription: '' when LLM caption fails (non-fatal)", async () => {
    // captionLocation() swallows LLM errors and returns null. The route
    // still persists source_image_url AND returns 200 (NOT 502). Response
    // coerces DB null → "" per spec §Pass 6 S-1.
    vi.mocked(captionLocation).mockResolvedValueOnce(null)
    const jobs = mockJobFetch({
      data: { id: TEST_JOB_ID, status: "completed", output_data: { imageUrl: IMAGE_URL } },
      error: null,
    })
    const locationPreFetch = mockLocationPreFetch({ data: { id: TEST_LOCATION_ID }, error: null })
    const locationUpdate = mockLocationUpdate({
      data: { source_image_url: IMAGE_URL, canonical_description: null },
      error: null,
    })
    wireSupabase({ jobs, locationPreFetch, locationUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      sourceImageUrl: IMAGE_URL,
      canonicalDescription: "",
    })
    // Critical contract: source_image_url IS still persisted; only
    // canonical_description is null in the UPDATE.
    expect(locationUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        source_image_url: IMAGE_URL,
        canonical_description: null,
      }),
    )
  })

  it("returns 500 when persist UPDATE fails", async () => {
    const jobs = mockJobFetch({
      data: { id: TEST_JOB_ID, status: "completed", output_data: { imageUrl: IMAGE_URL } },
      error: null,
    })
    const locationPreFetch = mockLocationPreFetch({ data: { id: TEST_LOCATION_ID }, error: null })
    const locationUpdate = mockLocationUpdate({
      data: null,
      error: { message: "DB write failed" },
    })
    wireSupabase({ jobs, locationPreFetch, locationUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/locations/${TEST_LOCATION_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("update_failed")
  })
})

// ---------------------------------------------------------------------------
// captionLocation helper — direct unit tests for truncation / null paths.
// (Separate from the route tests because the route mocks the helper.)
// ---------------------------------------------------------------------------

describe("captionLocation helper", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Restore the real implementation for these tests by re-importing — vi's
    // mock returns `...actual` so the import below already gives us the real
    // function. The mocks above only override the `captionLocation` export
    // when consumed via the mocked module; we re-import the actual module
    // here to test the helper directly.
  })

  it("truncates output > 4000 chars to <= 3990 at sentence boundary", async () => {
    const { captionLocation: realCaptionLocation } = await vi.importActual<
      typeof import("../../lib/location-caption.js")
    >("../../lib/location-caption.js")
    const { llmComplete } = await import("../../lib/llm-client.js")

    // Build a 5000-char string ending in a "." at offset 3900 so truncation
    // picks it as the last sentence boundary (> 100 threshold).
    const filler = "abcdefghij".repeat(389) // 3890 chars
    const tail = "." + "z".repeat(1109) // forces total length > 4000
    const longText = filler + tail // length: 3890 + 1110 = 5000
    expect(longText.length).toBe(5000)
    expect(longText.charAt(3890)).toBe(".") // sentence boundary at 3890

    vi.mocked(llmComplete).mockResolvedValueOnce({
      text: longText,
      model: "claude-sonnet-4.6",
    } as Awaited<ReturnType<typeof llmComplete>>)

    const result = await realCaptionLocation("https://r2.example.com/x.jpg")
    expect(result).not.toBeNull()
    // 3990-cap slice + truncate-at-period → length ≤ 3990 + 1 (for the dot).
    expect(result!.length).toBeLessThanOrEqual(3991)
    expect(result!.endsWith(".")).toBe(true)
  })

  it("returns null when LLM throws", async () => {
    const { captionLocation: realCaptionLocation } = await vi.importActual<
      typeof import("../../lib/location-caption.js")
    >("../../lib/location-caption.js")
    const { llmComplete } = await import("../../lib/llm-client.js")
    vi.mocked(llmComplete).mockRejectedValueOnce(new Error("LLM down"))

    const result = await realCaptionLocation("https://r2.example.com/x.jpg")
    expect(result).toBeNull()
  })

  it("returns null on empty/whitespace text", async () => {
    const { captionLocation: realCaptionLocation } = await vi.importActual<
      typeof import("../../lib/location-caption.js")
    >("../../lib/location-caption.js")
    const { llmComplete } = await import("../../lib/llm-client.js")
    vi.mocked(llmComplete).mockResolvedValueOnce({
      text: "   \n  ",
      model: "claude-sonnet-4.6",
    } as Awaited<ReturnType<typeof llmComplete>>)

    const result = await realCaptionLocation("https://r2.example.com/x.jpg")
    expect(result).toBeNull()
  })
})
