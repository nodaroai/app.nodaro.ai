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
  return { safeUrlSchema: z.string().url() }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateObjectRoutes } from "../generate-object.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_OBJECT_ID = "00000000-0000-4000-8000-000000000077"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  // Bypass auth — set userId from header.
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateObjectRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Routed supabase mock:
 *   - "objects" → ownership pre-check chain returning the supplied row (or null)
 *   - "jobs"    → insert chain returning job-1..job-4 sequentially
 *
 * Pass `objectRow: { id }` to simulate a valid ownership pre-check (caller
 * owns + not soft-deleted). Pass `null` to simulate cross-user / missing /
 * soft-deleted (route MUST 404 `not_found`).
 */
function setupSupabaseMock(opts: {
  objectRow?: { id: string } | null
} = {}) {
  const objectMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.objectRow === undefined ? null : opts.objectRow, error: null })
  const objectIs = vi.fn().mockReturnValue({ maybeSingle: objectMaybeSingle })
  const objectEq2 = vi.fn().mockReturnValue({ is: objectIs })
  const objectEq1 = vi.fn().mockReturnValue({ eq: objectEq2 })
  const objectSelect = vi.fn().mockReturnValue({ eq: objectEq1 })

  const jobSingle = vi
    .fn()
    .mockResolvedValueOnce({ data: { id: "job-1" }, error: null })
    .mockResolvedValueOnce({ data: { id: "job-2" }, error: null })
    .mockResolvedValueOnce({ data: { id: "job-3" }, error: null })
    .mockResolvedValueOnce({ data: { id: "job-4" }, error: null })
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "objects") return { select: objectSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })

  return { objectSelect, objectMaybeSingle, jobInsert }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-object — multi-candidate + auto-attach (Phase C2a)", () => {
  it("count=1 (default) returns { jobId } single shape — backward compat", async () => {
    const { jobInsert } = setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Ornate Goblet" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.jobIds).toBeUndefined()
    expect(jobInsert).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("count=4 inserts 4 jobs and returns { jobIds } with length 4", async () => {
    const { jobInsert } = setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Ornate Goblet", count: 4 },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toEqual(["job-1", "job-2", "job-3", "job-4"])
    expect(body.jobId).toBeUndefined()
    expect(jobInsert).toHaveBeenCalledTimes(4)
    expect(videoQueue.add).toHaveBeenCalledTimes(4)
  })

  it("count=2 returns { jobIds } with length 2", async () => {
    const { jobInsert } = setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Ornate Goblet", count: 2 },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toEqual(["job-1", "job-2"])
    expect(body.jobId).toBeUndefined()
    expect(jobInsert).toHaveBeenCalledTimes(2)
    expect(videoQueue.add).toHaveBeenCalledTimes(2)
  })

  it("returns 400 for invalid count value (5)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      // 1/2/3/4 are valid; 5 is out of range.
      payload: { name: "Ornate Goblet", count: 5 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      payload: { name: "Ornate Goblet" },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Ownership pre-check (spec Pass 3 F-30 + Pass 10 F-90b uniform 404)
  // ──────────────────────────────────────────────────────────────────────────

  it("returns 404 not_found when attachToObjectId is cross-user / does not exist", async () => {
    const { jobInsert } = setupSupabaseMock({ objectRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Ornate Goblet", attachToObjectId: TEST_OBJECT_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    // Uniform "not_found" — same code for missing / cross-user / soft-deleted.
    // No job insert, no enqueue.
    expect(jobInsert).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("returns 404 not_found when attachToObjectId is soft-deleted (uniform code)", async () => {
    // The route's `.is("deleted_at", null)` clause filters soft-deleted rows,
    // so a soft-deleted row returns null from the supabase query — same as
    // cross-user. Uniform 404 per Pass 10 F-90b — no enumeration leak.
    const { jobInsert } = setupSupabaseMock({ objectRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Ornate Goblet", attachToObjectId: TEST_OBJECT_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(jobInsert).not.toHaveBeenCalled()
  })

  it("count=1 + valid attachToObjectId — attach metadata flows to queue payload", async () => {
    const { jobInsert } = setupSupabaseMock({ objectRow: { id: TEST_OBJECT_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Ornate Goblet",
        attachToObjectId: TEST_OBJECT_ID,
        attachName: "Ornate Goblet",
        seedPromptHint: "an ornate brass goblet with intricate engravings",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(jobInsert).toHaveBeenCalledTimes(1)

    // attachToObjectId IS in the job input_data (single-candidate path).
    const insertedPayload = jobInsert.mock.calls[0][0] as { input_data: Record<string, unknown> }
    expect(insertedPayload.input_data.attachToObjectId).toBe(TEST_OBJECT_ID)
    expect(insertedPayload.input_data.attachName).toBe("Ornate Goblet")

    // And in the queue payload (single source of truth — matches input_data).
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-object",
      expect.objectContaining({
        jobId: "job-1",
        attachToObjectId: TEST_OBJECT_ID,
        attachName: "Ornate Goblet",
        seedPromptHint: "an ornate brass goblet with intricate engravings",
      }),
    )
  })

  it("count=4 + valid attachToObjectId — NONE of the 4 jobs carry attach metadata (must go through approval)", async () => {
    const { jobInsert } = setupSupabaseMock({ objectRow: { id: TEST_OBJECT_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Ornate Goblet",
        count: 4,
        attachToObjectId: TEST_OBJECT_ID,
        attachName: "Ornate Goblet",
      },
    })

    expect(jobInsert).toHaveBeenCalledTimes(4)
    for (const call of jobInsert.mock.calls) {
      const payload = call[0] as { input_data: Record<string, unknown> }
      expect(payload.input_data.attachToObjectId).toBeUndefined()
      expect(payload.input_data.attachName).toBeUndefined()
    }
    // Queue payload likewise lacks attachToObjectId on every enqueue.
    for (const call of vi.mocked(videoQueue.add).mock.calls) {
      const enqueued = call[1] as Record<string, unknown>
      expect(enqueued.attachToObjectId).toBeUndefined()
      expect(enqueued.attachName).toBeUndefined()
    }
  })

  it("seedPromptHint flows to queue even without attachToObjectId (Phase E picker)", async () => {
    setupSupabaseMock()

    await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Ornate Goblet",
        seedPromptHint: "ornate brass goblet",
      },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-object",
      expect.objectContaining({
        seedPromptHint: "ornate brass goblet",
      }),
    )
  })

  it("force_private respects user setting (not hardcoded — only motion hardcodes per spec Pass 6 F-75)", async () => {
    const { jobInsert } = setupSupabaseMock()

    await app.inject({
      method: "POST",
      url: "/v1/generate-object",
      headers: { "x-user-id": TEST_USER_ID },
      // No forcePrivate sent → routes via extractForcePrivate, which returns
      // undefined for this body shape. The route falls back to `undefined` so
      // the column inherits the DB default (NOT a hardcoded true).
      payload: { name: "Ornate Goblet" },
    })

    expect(jobInsert).toHaveBeenCalledTimes(1)
    const insertedPayload = jobInsert.mock.calls[0][0] as { force_private?: unknown }
    expect(insertedPayload.force_private).toBeUndefined()
  })
})
