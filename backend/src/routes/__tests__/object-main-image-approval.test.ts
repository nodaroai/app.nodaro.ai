import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supabase } from "../../lib/supabase.js"
import { captionObject } from "../../lib/object-caption.js"
import { objectMainImageApprovalRoutes } from "../object-main-image-approval.js"

// captionObject is mocked at the helper boundary — the route only sees the
// helper's resolved `string | null`. Tests for the helper's own behaviour
// (truncation, error swallow) hit the real implementation in the C1a
// helper test file (object-caption.test.ts) — keep this file route-focused.
vi.mock("../../lib/object-caption.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/object-caption.js")>(
    "../../lib/object-caption.js",
  )
  return {
    ...actual,
    captionObject: vi.fn(),
  }
})
vi.mock("../../lib/llm-client.js", () => ({ llmComplete: vi.fn() }))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// CI has no .env so config.ANTHROPIC_API_KEY / KIE_API_KEY would be empty,
// tripping the 503 provider_unavailable preflight. Mock as truthy.
vi.mock("../../lib/config.js", () => ({
  config: { ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "test-key" },
}))

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_OBJECT_ID = "00000000-0000-4000-8000-000000000020"
const TEST_JOB_ID = "00000000-0000-4000-8000-000000000030"
const IMAGE_URL = "https://r2.example.com/object-candidate.jpg"
const SAMPLE_CAPTION =
  "A polished brass nautical compass, the rim incised with cardinal directions in serif lettering. " +
  "A bevelled glass cover overlies a paper rose with delicate ink hatching. Patina of fine surface scratches indicates regular use."

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(captionObject).mockResolvedValue(SAMPLE_CAPTION)
  app = Fastify({ logger: false })
  // Simulate auth middleware: set req.userId from X-User-Id header (matches
  // location-main-image-approval.test.ts pattern).
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (i) => {
    await objectMainImageApprovalRoutes(i)
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

// .from("objects").select("id").eq("id", ..).eq("user_id", ..).is("deleted_at", null).single()
function mockObjectPreFetch(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const is = vi.fn().mockReturnValue({ single })
  const eq2 = vi.fn().mockReturnValue({ is })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, eq1, eq2, is, single }
}

// .from("objects").update(..).eq("id", ..).eq("user_id", ..).select(..).single()
//   — OR with expectedUpdatedAt:
// .from("objects").update(..).eq("id", ..).eq("user_id", ..).eq("updated_at", ..).select(..).single()
// The route adds the third `.eq("updated_at", expectedUpdatedAt)` only
// when the caller passed `expectedUpdatedAt`, so the chain mock supports
// both shapes by making the second `.eq` chainable.
function mockObjectUpdate(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const selectAfter = vi.fn().mockReturnValue({ single })
  // eq2 returns an object that ALSO has `eq` for the optional third filter
  // (updated_at). Both `eq2(...).select(...)` and
  // `eq2(...).eq(...).select(...)` resolve to the same `select` mock.
  const eq3 = vi.fn().mockReturnValue({ select: selectAfter })
  const eq2 = vi.fn().mockReturnValue({ select: selectAfter, eq: eq3 })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const update = vi.fn().mockReturnValue({ eq: eq1 })
  return { update, eq1, eq2, eq3, selectAfter, single }
}

// .from("objects").select("updated_at").eq("id", ..).eq("user_id", ..).single()
//   — fresh-row lookup after a stale-token UPDATE returns zero rows.
function mockObjectFreshLookup(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const eq2 = vi.fn().mockReturnValue({ single })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select, eq1, eq2, single }
}

function wireSupabase(parts: {
  jobs?: ReturnType<typeof mockJobFetch>
  objectPreFetch?: ReturnType<typeof mockObjectPreFetch>
  objectUpdate?: ReturnType<typeof mockObjectUpdate>
  /** Third objects call: fresh-row lookup after a stale-token UPDATE
   *  returns zero rows. Only used by the 409 path. */
  objectFreshLookup?: ReturnType<typeof mockObjectFreshLookup>
}) {
  let objCall = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "jobs") {
      if (!parts.jobs) throw new Error("test forgot to set jobs mock")
      return { select: parts.jobs.select } as never
    }
    if (table === "objects") {
      objCall++
      if (objCall === 1) {
        // First objects call = pre-fetch
        if (!parts.objectPreFetch) throw new Error("test forgot to set objectPreFetch")
        return { select: parts.objectPreFetch.select } as never
      }
      if (objCall === 2) {
        // Second objects call = update
        if (!parts.objectUpdate) throw new Error("test forgot to set objectUpdate")
        return { update: parts.objectUpdate.update } as never
      }
      // Third objects call = fresh-row lookup (409 path only).
      if (!parts.objectFreshLookup) throw new Error("test forgot to set objectFreshLookup")
      return { select: parts.objectFreshLookup.select } as never
    }
    throw new Error(`unexpected table ${table}`)
  })
}

// Convenience: build a candidate job that's completed + has imageUrl + has
// attachToObjectId matching the URL :id (the happy-path shape).
function completedCandidate(extra: { attachToObjectId?: string | null } = {}) {
  const attachId = extra.attachToObjectId === undefined ? TEST_OBJECT_ID : extra.attachToObjectId
  return {
    id: TEST_JOB_ID,
    status: "completed",
    output_data: { imageUrl: IMAGE_URL },
    input_data: attachId === null ? {} : { attachToObjectId: attachId },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/objects/:id/approve-main-image", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(401)
  })

  it("returns 400 on invalid id param", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/not-a-uuid/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 400 on invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: "not-a-uuid" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns 404 'not_found' when candidate job not found (cross-user) — uniform code per Pass 10 F-90b", async () => {
    // Route scopes the candidate lookup by user_id, so a cross-user
    // candidateJobId returns no row. Object pre-fetch runs in parallel
    // but the candidate failure short-circuits BEFORE any LLM call / UPDATE.
    // Per spec Pass 10 F-90b, object uses uniform "not_found" (object
    // intentionally diverges from location's `candidate_job_not_found`).
    const jobs = mockJobFetch({ data: null, error: { code: "PGRST116" } })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    wireSupabase({ jobs, objectPreFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(jobs.eq1).toHaveBeenCalledWith("id", TEST_JOB_ID)
    expect(jobs.eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(vi.mocked(captionObject)).not.toHaveBeenCalled()
  })

  it("returns 400 'candidate_not_completed' when candidate job is not in completed state", async () => {
    const jobs = mockJobFetch({
      data: { id: TEST_JOB_ID, status: "running", output_data: null, input_data: {} },
      error: null,
    })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    wireSupabase({ jobs, objectPreFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("candidate_not_completed")
    expect(vi.mocked(captionObject)).not.toHaveBeenCalled()
  })

  it("returns 400 'candidate_no_image' when candidate has no imageUrl in output", async () => {
    const jobs = mockJobFetch({
      data: { id: TEST_JOB_ID, status: "completed", output_data: {}, input_data: {} },
      error: null,
    })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    wireSupabase({ jobs, objectPreFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("candidate_no_image")
  })

  it("returns 400 'candidate_object_mismatch' when candidate.input_data.attachToObjectId differs from :id (Pass 3 F-26 IDOR gate)", async () => {
    // The candidate was generated against a different object id. Both rows
    // are owned by the caller, but cross-linking them would let a user
    // promote candidate-A's output into object-B. The gate is BEFORE the
    // LLM call and BEFORE the UPDATE.
    const OTHER_OBJECT_ID = "00000000-0000-4000-8000-000000000099"
    const jobs = mockJobFetch({
      data: completedCandidate({ attachToObjectId: OTHER_OBJECT_ID }),
      error: null,
    })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    wireSupabase({ jobs, objectPreFetch })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("candidate_object_mismatch")
    expect(vi.mocked(captionObject)).not.toHaveBeenCalled()
  })

  it("returns 404 'not_found' when object is archived (deleted_at IS NULL filter rejects) — uniform code", async () => {
    // Archived rows have deleted_at != null. The pre-fetch's
    // `.is("deleted_at", null)` returns no row → 404 with uniform
    // "not_found" (no leak of object existence).
    const jobs = mockJobFetch({ data: completedCandidate(), error: null })
    const objectPreFetch = mockObjectPreFetch({ data: null, error: { code: "PGRST116" } })
    const objectUpdate = mockObjectUpdate({ data: null, error: null })
    wireSupabase({ jobs, objectPreFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(vi.mocked(captionObject)).not.toHaveBeenCalled()
    expect(objectUpdate.update).not.toHaveBeenCalled()
    // Verify the pre-fetch enforced ownership + not-deleted.
    expect(objectPreFetch.eq1).toHaveBeenCalledWith("id", TEST_OBJECT_ID)
    expect(objectPreFetch.eq2).toHaveBeenCalledWith("user_id", TEST_USER_ID)
    expect(objectPreFetch.is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 200 with { sourceImageUrl, canonicalDescription } on success", async () => {
    const jobs = mockJobFetch({ data: completedCandidate(), error: null })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    const objectUpdate = mockObjectUpdate({
      data: { source_image_url: IMAGE_URL, canonical_description: SAMPLE_CAPTION },
      error: null,
    })
    wireSupabase({ jobs, objectPreFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      sourceImageUrl: IMAGE_URL,
      canonicalDescription: SAMPLE_CAPTION,
    })
    // UPDATE row must include both new fields.
    expect(objectUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        source_image_url: IMAGE_URL,
        canonical_description: SAMPLE_CAPTION,
      }),
    )
  })

  it("returns 200 with canonicalDescription: '' when LLM caption fails (non-fatal)", async () => {
    // captionObject() swallows LLM errors and returns null. The route
    // still persists source_image_url AND returns 200 (NOT 502). Response
    // coerces DB null → "" so the frontend's non-nullable type stays
    // consistent. The retry route /llm-caption is the fatal-on-null
    // surface — both routes share the helper but have different contracts.
    vi.mocked(captionObject).mockResolvedValueOnce(null)
    const jobs = mockJobFetch({ data: completedCandidate(), error: null })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    const objectUpdate = mockObjectUpdate({
      data: { source_image_url: IMAGE_URL, canonical_description: null },
      error: null,
    })
    wireSupabase({ jobs, objectPreFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
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
    expect(objectUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        source_image_url: IMAGE_URL,
        canonical_description: null,
      }),
    )
  })

  // --------------------------------------------------------------------
  // Optimistic-concurrency (expectedUpdatedAt) — spec Pass 3 F-27
  // --------------------------------------------------------------------

  it("returns 200 when expectedUpdatedAt matches (token gates the UPDATE)", async () => {
    const FRESH = "2026-05-18T10:00:00.000Z"
    const jobs = mockJobFetch({ data: completedCandidate(), error: null })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    const objectUpdate = mockObjectUpdate({
      data: { source_image_url: IMAGE_URL, canonical_description: SAMPLE_CAPTION },
      error: null,
    })
    wireSupabase({ jobs, objectPreFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID, expectedUpdatedAt: FRESH },
    })
    expect(res.statusCode).toBe(200)
    // The route must call the third `.eq("updated_at", FRESH)` filter on UPDATE.
    expect(objectUpdate.eq3).toHaveBeenCalledWith("updated_at", FRESH)
  })

  it("returns 409 with { code, updatedAt, message } when expectedUpdatedAt is stale (concurrent modification)", async () => {
    const STALE = "2026-05-18T09:00:00.000Z"
    const FRESH = "2026-05-18T10:30:00.000Z"
    const jobs = mockJobFetch({ data: completedCandidate(), error: null })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    // UPDATE filtered everything out (token mismatch → zero rows).
    const objectUpdate = mockObjectUpdate({
      data: null,
      error: { code: "PGRST116", message: "no row" },
    })
    // Follow-up SELECT returns the row's current updated_at.
    const objectFreshLookup = mockObjectFreshLookup({
      data: { updated_at: FRESH },
      error: null,
    })
    wireSupabase({ jobs, objectPreFetch, objectUpdate, objectFreshLookup })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID, expectedUpdatedAt: STALE },
    })
    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.error.code).toBe("concurrent_modification")
    expect(body.error.updatedAt).toBe(FRESH)
    expect(body.error.message).toBeTruthy()
    // 409 body must be minimal — no row payload (matches save-route shape).
    expect(body.error).not.toHaveProperty("sourceImageUrl")
    expect(body.error).not.toHaveProperty("canonicalDescription")
    // Verify the UPDATE was actually gated on updated_at.
    expect(objectUpdate.eq3).toHaveBeenCalledWith("updated_at", STALE)
  })

  it("does NOT gate UPDATE on updated_at when expectedUpdatedAt is omitted (back-compat)", async () => {
    // Without expectedUpdatedAt the route stays last-write-wins (current
    // behaviour for callers that haven't upgraded). The third `.eq` for
    // updated_at must NOT be invoked.
    const jobs = mockJobFetch({ data: completedCandidate(), error: null })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    const objectUpdate = mockObjectUpdate({
      data: { source_image_url: IMAGE_URL, canonical_description: SAMPLE_CAPTION },
      error: null,
    })
    wireSupabase({ jobs, objectPreFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(200)
    // Critical: without expectedUpdatedAt, the route MUST NOT add the
    // updated_at filter (or it would silently 500 every time on UPDATE
    // because the omitted filter would pass eq3 with undefined).
    expect(objectUpdate.eq3).not.toHaveBeenCalled()
  })

  it("returns 400 when expectedUpdatedAt is malformed (not ISO datetime)", async () => {
    // Zod's `.datetime()` rejects non-ISO strings — the route must 400
    // before reaching any DB call. Validates the schema is wired correctly.
    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID, expectedUpdatedAt: "not-a-date" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 500 'update_failed' when persist UPDATE fails (without expectedUpdatedAt)", async () => {
    const jobs = mockJobFetch({ data: completedCandidate(), error: null })
    const objectPreFetch = mockObjectPreFetch({ data: { id: TEST_OBJECT_ID }, error: null })
    const objectUpdate = mockObjectUpdate({
      data: null,
      error: { message: "DB write failed" },
    })
    wireSupabase({ jobs, objectPreFetch, objectUpdate })

    const res = await app.inject({
      method: "POST",
      url: `/v1/objects/${TEST_OBJECT_ID}/approve-main-image`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { candidateJobId: TEST_JOB_ID },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("update_failed")
  })
})
