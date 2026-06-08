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

// Per-job creditOverride correction relies on these two dynamic imports inside
// the route (`../ee/billing/credits.js`, `../lib/app-settings.js`). The `@/`
// alias resolves to the same files, so these mocks intercept those import()s.
const mockGetModelCreditBaseCost = vi.fn()
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: mockGetModelCreditBaseCost,
}))
const mockGetAppSettings = vi.fn()
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: mockGetAppSettings,
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

import { generateCreatureRoutes } from "../generate-creature.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CREATURE_ID = "00000000-0000-4000-8000-000000000077"

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
    await generateCreatureRoutes(instance)
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
 *   - "creatures" → ownership pre-check chain returning the supplied row (or null)
 *   - "jobs"      → insert chain returning job-1..job-N sequentially
 *
 * Pass `creatureRow: { id }` to simulate a valid ownership pre-check (caller
 * owns + not soft-deleted). Pass `null` to simulate cross-user / missing /
 * soft-deleted (route MUST 404 `not_found`).
 */
function setupSupabaseMock(opts: {
  creatureRow?: { id: string } | null
} = {}) {
  const creatureMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.creatureRow === undefined ? null : opts.creatureRow, error: null })
  const creatureIs = vi.fn().mockReturnValue({ maybeSingle: creatureMaybeSingle })
  const creatureEq2 = vi.fn().mockReturnValue({ is: creatureIs })
  const creatureEq1 = vi.fn().mockReturnValue({ eq: creatureEq2 })
  const creatureSelect = vi.fn().mockReturnValue({ eq: creatureEq1 })

  // N-agnostic: yields job-1, job-2, … on each successive `.single()` call so
  // the mock supports any `count` (1–10) without enumerating fixed ids.
  let jobN = 0
  const jobSingle = vi.fn().mockImplementation(() => {
    jobN += 1
    return Promise.resolve({ data: { id: `job-${jobN}` }, error: null })
  })
  const jobSelect = vi.fn().mockReturnValue({ single: jobSingle })
  const jobInsert = vi.fn().mockReturnValue({ select: jobSelect })

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "creatures") return { select: creatureSelect } as never
    if (table === "jobs") return { insert: jobInsert } as never
    return {} as never
  })

  return { creatureSelect, creatureMaybeSingle, jobInsert }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-creature — multi-candidate + auto-attach (Phase D5)", () => {
  it("count=1 (default) returns BOTH jobIds AND the deprecated jobId alias (harmonized contract)", async () => {
    const { jobInsert } = setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon", species: "dragon" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toEqual(["job-1"])
    expect(body.jobId).toBe("job-1")
    expect(jobInsert).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("count=4 inserts 4 jobs and returns { jobIds } with length 4", async () => {
    const { jobInsert } = setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon", count: 4 },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toEqual(["job-1", "job-2", "job-3", "job-4"])
    expect(body.jobId).toBeUndefined()
    expect(jobInsert).toHaveBeenCalledTimes(4)
    expect(videoQueue.add).toHaveBeenCalledTimes(4)
  })

  it("count=10 (max) inserts 10 jobs and enqueues 10", async () => {
    const { jobInsert } = setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon", count: 10 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(10)
    expect(jobInsert).toHaveBeenCalledTimes(10)
    expect(videoQueue.add).toHaveBeenCalledTimes(10)
  })

  it("returns 400 for count above the max (11)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon", count: 11 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for count below the min (0)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon", count: 0 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      payload: { name: "Crimson Dragon" },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Ownership pre-check (owner-scoping; uniform 404 mirrors object)
  // ──────────────────────────────────────────────────────────────────────────

  it("returns 404 not_found when attachToCreatureId is cross-user / does not exist", async () => {
    const { jobInsert } = setupSupabaseMock({ creatureRow: null })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon", attachToCreatureId: TEST_CREATURE_ID },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(jobInsert).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("scopes the ownership pre-check to the caller (eq user_id) before any job insert", async () => {
    const { creatureSelect, creatureMaybeSingle, jobInsert } = setupSupabaseMock({
      creatureRow: { id: TEST_CREATURE_ID },
    })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon", attachToCreatureId: TEST_CREATURE_ID },
    })

    expect(res.statusCode).toBe(200)
    // The ownership pre-check queries the `creatures` table (NOT objects) and
    // runs before the insert (owner-scoping invariant).
    expect(creatureSelect).toHaveBeenCalled()
    expect(creatureMaybeSingle).toHaveBeenCalled()
    expect(jobInsert).toHaveBeenCalled()
  })

  it("count=1 + valid attachToCreatureId — attach metadata flows to queue payload with generate-creature logPrefix", async () => {
    const { jobInsert } = setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Crimson Dragon",
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "Crimson Dragon",
        seedPromptHint: "a fierce crimson dragon with iridescent scales",
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(jobInsert).toHaveBeenCalledTimes(1)

    // attachToCreatureId IS in the job input_data (single-candidate path).
    const insertedPayload = jobInsert.mock.calls[0][0] as { input_data: Record<string, unknown> }
    expect(insertedPayload.input_data.attachToCreatureId).toBe(TEST_CREATURE_ID)
    expect(insertedPayload.input_data.attachName).toBe("Crimson Dragon")

    // The BullMQ job is named "generate-creature" — must match the Phase C2
    // entityHandlers key the creature worker registered. The payload carries
    // attachToCreatureId + the seed hint (single source of truth — matches
    // input_data).
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-creature",
      expect.objectContaining({
        jobId: "job-1",
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "Crimson Dragon",
        seedPromptHint: "a fierce crimson dragon with iridescent scales",
      }),
    )
  })

  it("count=4 + valid attachToCreatureId — NONE of the 4 jobs carry attach metadata (must go through approval)", async () => {
    const { jobInsert } = setupSupabaseMock({ creatureRow: { id: TEST_CREATURE_ID } })

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Crimson Dragon",
        count: 4,
        attachToCreatureId: TEST_CREATURE_ID,
        attachName: "Crimson Dragon",
      },
    })

    expect(jobInsert).toHaveBeenCalledTimes(4)
    for (const call of jobInsert.mock.calls) {
      const payload = call[0] as { input_data: Record<string, unknown> }
      expect(payload.input_data.attachToCreatureId).toBeUndefined()
      expect(payload.input_data.attachName).toBeUndefined()
    }
    for (const call of vi.mocked(videoQueue.add).mock.calls) {
      const enqueued = call[1] as Record<string, unknown>
      expect(enqueued.attachToCreatureId).toBeUndefined()
      expect(enqueued.attachName).toBeUndefined()
    }
  })

  // ───────────────────────────────────────────────────────────────────────
  // Pricing — the spec's audit caught a fabricated `"generate-creature"`
  // credit key. The credit model identifier MUST be the request `provider`
  // (e.g. "nano-banana"), NEVER a literal "generate-creature".
  // ───────────────────────────────────────────────────────────────────────

  it("prices by the request `provider` — reserveCreditsForJob is called with the provider, NOT the literal 'generate-creature'", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon", provider: "flux" },
    })

    expect(res.statusCode).toBe(200)
    // The 4th arg to reserveCreditsForJob is the credit model identifier.
    expect(reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "job-1",
      "flux",
    )
    const modelIdentifierArg = vi.mocked(reserveCreditsForJob).mock.calls[0][3]
    expect(modelIdentifierArg).toBe("flux")
    expect(modelIdentifierArg).not.toBe("generate-creature")
  })

  it("defaults the credit identifier to nano-banana when no provider is sent (NOT 'generate-creature')", async () => {
    setupSupabaseMock()

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon" },
    })

    expect(res.statusCode).toBe(200)
    const modelIdentifierArg = vi.mocked(reserveCreditsForJob).mock.calls[0][3]
    expect(modelIdentifierArg).toBe("nano-banana")
    expect(modelIdentifierArg).not.toBe("generate-creature")
    // Enqueued under the same provider — single source of truth.
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-creature",
      expect.objectContaining({ provider: "nano-banana" }),
    )
  })

  it("seedPromptHint flows to queue even without attachToCreatureId (Phase E picker)", async () => {
    setupSupabaseMock()

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Crimson Dragon",
        seedPromptHint: "fierce crimson dragon",
      },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-creature",
      expect.objectContaining({
        seedPromptHint: "fierce crimson dragon",
      }),
    )
  })

  it("force_private respects user setting (not hardcoded)", async () => {
    const { jobInsert } = setupSupabaseMock()

    await app.inject({
      method: "POST",
      url: "/v1/generate-creature",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Crimson Dragon" },
    })

    expect(jobInsert).toHaveBeenCalledTimes(1)
    const insertedPayload = jobInsert.mock.calls[0][0] as { force_private?: unknown }
    expect(insertedPayload.force_private).toBeUndefined()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Per-job credit override — the N² over-charge regression guard.
  // The preHandler reserves the BATCH total once; without the per-job reset
  // the N-call reservation loop reuses that batch total for EVERY job.
  // ───────────────────────────────────────────────────────────────────────
  describe("per-job credit override (N² over-charge guard)", () => {
    const BASE_PER_JOB = 4
    const MARKUP_PERCENT = 25
    const PER_JOB_OVERRIDE = Math.ceil(BASE_PER_JOB * (1 + MARKUP_PERCENT / 100)) // 5

    let perJobApp: FastifyInstance
    let recordedOverrides: Array<number | undefined>

    beforeEach(async () => {
      recordedOverrides = []
      mockGetModelCreditBaseCost.mockResolvedValue({
        creditCost: BASE_PER_JOB,
        isEnabled: true,
        tierRestriction: null,
      })
      mockGetAppSettings.mockResolvedValue({
        ai_provider: "replicate",
        cost_markup_percent: MARKUP_PERCENT,
        carousel_video_autoplay: true,
        apps_page_video_autoplay: true,
        featured_app_ids: [],
        featured_apps_limit: 20,
        apps_auto_scroll_seconds: 4,
      })
      vi.mocked(reserveCreditsForJob).mockImplementation(async (req: any) => {
        recordedOverrides.push(req.creditReservation?.creditOverride)
        return { usageLogId: `log-${recordedOverrides.length}`, creditsReserved: PER_JOB_OVERRIDE, watermark: false }
      })

      perJobApp = Fastify({ logger: false })
      perJobApp.addHook("preHandler", async (req) => {
        const header = req.headers["x-user-id"]
        if (typeof header === "string") req.userId = header
        const countHeader = req.headers["x-batch-count"]
        const count = typeof countHeader === "string" ? Number(countHeader) : 1
        req.creditReservation = {
          usageLogId: "",
          creditsReserved: 0,
          watermark: false,
          creditOverride: Math.ceil(BASE_PER_JOB * count * (1 + MARKUP_PERCENT / 100)),
        }
      })
      await perJobApp.register(async (instance) => {
        await generateCreatureRoutes(instance)
      })
      await perJobApp.ready()
    })

    afterEach(async () => {
      await perJobApp.close()
    })

    it("count=10: every reservation sees the per-job override, not the batch total", async () => {
      setupSupabaseMock()

      const res = await perJobApp.inject({
        method: "POST",
        url: "/v1/generate-creature",
        headers: { "x-user-id": TEST_USER_ID, "x-batch-count": "10" },
        payload: { name: "Crimson Dragon", count: 10 },
      })

      expect(res.statusCode).toBe(200)
      expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledTimes(10)
      expect(recordedOverrides).toEqual(Array(10).fill(PER_JOB_OVERRIDE))
      const totalDebited = recordedOverrides.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)
      expect(totalDebited).toBe(10 * PER_JOB_OVERRIDE) // 50, NOT 500
    })

    it("count=1: the single reservation also sees the per-job override", async () => {
      setupSupabaseMock()

      const res = await perJobApp.inject({
        method: "POST",
        url: "/v1/generate-creature",
        headers: { "x-user-id": TEST_USER_ID, "x-batch-count": "1" },
        payload: { name: "Crimson Dragon" },
      })

      expect(res.statusCode).toBe(200)
      expect(recordedOverrides).toEqual([PER_JOB_OVERRIDE])
    })
  })
})
