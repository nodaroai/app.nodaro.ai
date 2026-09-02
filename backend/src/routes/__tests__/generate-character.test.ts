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

/**
 * The documented defaults of the module-level mocks, in ONE place so the
 * factories below and the per-test re-seed in `beforeEach` cannot disagree.
 */
const DEFAULTS = vi.hoisted(() => ({
  reservation: { usageLogId: "log-1", creditsReserved: 6, watermark: false },
  queuedJob: { id: "queue-job-1" },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue(DEFAULTS.queuedJob),
  },
  redis: {},
}))

vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn().mockResolvedValue(DEFAULTS.reservation),
}))

// Per-job creditOverride correction relies on these two dynamic imports inside
// the route. The route imports them as `../ee/billing/credits.js` and
// `../lib/app-settings.js`; the `@/` alias resolves to the same files, so these
// mocks intercept the route's dynamic import() calls.
const mockGetModelCreditBaseCost = vi.fn()
vi.mock("@/ee/billing/credits.js", () => ({
  getModelCreditBaseCost: mockGetModelCreditBaseCost,
}))
const mockGetAppSettings = vi.fn()
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: mockGetAppSettings,
}))

// Mock the dynamic import path the route uses to load CreditsService for
// rollback refunds. The route does `await import("../ee/services/credits.js")`
// in the mid-batch failure path; this mock intercepts that lazy load.
const mockRefundCredits = vi.fn().mockResolvedValue(undefined)
vi.mock("@/ee/services/credits.js", () => ({
  CreditsService: { refundCredits: mockRefundCredits },
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

// Facet extraction (P2) — the route awaits resolveFacetInjections to turn
// `facetInjections: [{ sourceText, facet }]` into a prompt fragment. The helper
// has its own unit tests (character-facet-extract.test.ts); here we mock it to a
// deterministic marker so the route's prompt-weaving is what's under test.
// `vi.hoisted` so the const is available inside the hoisted vi.mock factory.
const mockResolveFacetInjections = vi.hoisted(() => vi.fn(async (): Promise<string> => ""))
vi.mock("@/lib/character-facet-extract.js", () => ({
  resolveFacetInjections: mockResolveFacetInjections,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { generateCharacterRoutes } from "../generate-character.js"
import { supabase } from "../../lib/supabase.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { resolveEntityImageParams } from "../../lib/entity-credit-identifier.js"
import { PORTRAIT_SCAFFOLDING, CLOTHED_DEFAULT } from "../../lib/character-prompts.js"
import { MODEST_ATTIRE_CLAUSE, registerMainlinePromptPolicies } from "../../lib/prompt-policies/index.js"
import { applyPromptPolicies, clearPromptPolicies } from "../../lib/prompt-policy.js"

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_CHARACTER_ID = "00000000-0000-4000-8000-000000000099"

let app: FastifyInstance

/**
 * Re-seed every module-level mock to its documented default.
 *
 * `vi.clearAllMocks()` clears call DATA only — implementations and unconsumed
 * `…Once` queues survive it. So a nested describe that calls
 * `mockImplementation` (rather than `…Once`) leaks into every test that
 * follows it, and that was live here: the "per-job credit override" block
 * replaced `reserveCreditsForJob` with a recorder whose usageLogId counts up
 * (`log-1`, `log-2`, …) and never put the default back, so every later test
 * silently ran against that recorder. Nothing asserted usageLogId after it, so
 * it stayed invisible — the next test to assert one would have failed on a
 * value that drifts with how many tests ran before it.
 *
 * Re-seeding HERE rather than restoring in each nested `afterEach` is the
 * invariant: no test can inherit another's implementation whatever any block
 * does, and a new nested override needs no cleanup of its own to be safe.
 * `mockReset` (not `mockClear`) is what drops a leftover `…Once` too.
 */
function resetModuleMocks(): void {
  vi.mocked(reserveCreditsForJob).mockReset()
  vi.mocked(reserveCreditsForJob).mockResolvedValue(DEFAULTS.reservation)

  vi.mocked(videoQueue.add).mockReset()
  vi.mocked(videoQueue.add).mockResolvedValue(DEFAULTS.queuedJob as never)

  mockRefundCredits.mockReset()
  mockRefundCredits.mockResolvedValue(undefined)

  mockResolveFacetInjections.mockReset()
  mockResolveFacetInjections.mockImplementation(async () => "")

  // No factory default — the route only reads these when a creditReservation
  // exists, which the per-job block is alone in setting up.
  mockGetModelCreditBaseCost.mockReset()
  mockGetAppSettings.mockReset()
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetModuleMocks()
  app = Fastify({ logger: false })
  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await generateCharacterRoutes(instance)
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
 * Build a fresh `from("jobs").insert(...).select("id").single()` chain whose
 * `.single()` resolves with a different job id for each call (job-1, job-2, …).
 * Returns the top-level insert mock so tests can assert on payload + call count.
 *
 * Also supports `.delete().in("id", [...])` for rollback paths — the same
 * `from()` value carries both `.insert(...)` and `.delete()` shapes, which
 * mirrors how Supabase chains work in the real client.
 */
/**
 * `from("characters").select("person, wardrobe").eq().eq().is().single()` shape
 * used by the route's optional structured-fields fetch when `attachToCharacterId`
 * is present. Resolves to `{ data: null }` by default (no person/wardrobe), which
 * the route handles gracefully (hints stay empty). Merge onto the `from()` mock
 * object alongside `insert` so both the characters-select and jobs-insert chains
 * resolve off the same returned value.
 */
function charSelectChain(row: Record<string, unknown> | null = null) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null })
  const is = vi.fn().mockReturnValue({ single })
  const eq2 = vi.fn().mockReturnValue({ is })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  return { select }
}

function mockJobsInsertChain() {
  // N-agnostic: yields job-1, job-2, … on each successive `.single()` call so
  // the helper supports any `count` (1–10) without enumerating fixed ids.
  let n = 0
  const single = vi.fn().mockImplementation(() => {
    n += 1
    return Promise.resolve({ data: { id: `job-${n}` }, error: null })
  })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  // `.delete().in("id", [...])` returns a thenable that resolves to { error: null }
  const inFn = vi.fn().mockResolvedValue({ error: null })
  const del = vi.fn().mockReturnValue({ in: inFn })
  return { insert, select, single, delete: del, in: inFn }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/generate-character", () => {
  it("count=1 (default) returns { jobId, jobIds } dual shape — jobIds has length 1", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "young woman, designer glasses",
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toHaveLength(1)
    expect(body.jobId).toBe(body.jobIds[0])
    expect(insert).toHaveBeenCalledTimes(1)
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
  })

  it("count=4 inserts 4 jobs and returns { jobId, jobIds } with length 4", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "young woman",
        count: 4,
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobIds).toHaveLength(4)
    expect(body.jobId).toBe(body.jobIds[0])
    expect(insert).toHaveBeenCalledTimes(4)
    expect(videoQueue.add).toHaveBeenCalledTimes(4)
  })

  it("count=10 (new max) inserts 10 jobs and reserves 10 — cap raised 4→10 (WI-3)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "young woman",
        count: 10,
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(10)
    expect(insert).toHaveBeenCalledTimes(10)
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledTimes(10)
    expect(videoQueue.add).toHaveBeenCalledTimes(10)
  })

  it("count=2 returns jobIds length 2", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "y w", count: 2 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(2)
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it("force_private: true on every inserted job (ignores body forcePrivate=false)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "y w",
        count: 2,
        forcePrivate: false, // route must ignore this and still set force_private: true
      },
    })

    expect(insert).toHaveBeenCalledTimes(2)
    for (const call of insert.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ force_private: true }))
    }
  })

  it("returns 400 when seedPrompt, referencePhotos, and description are all absent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for count above the max (11)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      // 1–10 are valid (WI-3 raised the cap 4→10); 11 is out of range.
      payload: { name: "Kira", seedPrompt: "x", count: 11 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for count below the min (0)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "x", count: 0 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("accepts referencePhotos (legacy seedPrompt absent)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        referencePhotos: [
          { url: "https://example.com/ref-front.png", kind: "frontFace" },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(1)
  })

  it("accepts legacy description-only payload", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", description: "tall woman with red hair" },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(1)
  })

  it("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      payload: { name: "Kira", seedPrompt: "x" },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("seedPrompt produces a portrait prompt with studio scaffolding", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "young woman, glasses" },
    })

    const insertedPayload = insert.mock.calls[0][0] as { input_data: { prompt: string } }
    // Studio portrait scaffolding from buildPortraitPrompt
    expect(insertedPayload.input_data.prompt).toContain("young woman, glasses")
    expect(insertedPayload.input_data.prompt).toContain("studio lighting")
    expect(insertedPayload.input_data.prompt).toContain("plain background")
  })

  // ───────────────────────────────────────────────────────────────────────
  // Element/asset injection (P2) — facetInjections resolve (server-side LLM
  // extraction, mocked here) and weave into the SAME injection slot as P1's
  // injectedAssets. No facetInjections → byte-identical no-op.
  // ───────────────────────────────────────────────────────────────────────
  describe("element/asset injection (facetInjections)", () => {
    it("weaves the resolved facet text into the portrait prompt", async () => {
      mockResolveFacetInjections.mockResolvedValueOnce("curly red hair")
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "young woman",
          facetInjections: [{ sourceText: "char 1 description", facet: "hair" }],
        },
      })

      expect(mockResolveFacetInjections).toHaveBeenCalledWith([
        { sourceText: "char 1 description", facet: "hair" },
      ])
      const inserted = insert.mock.calls[0][0] as { input_data: { prompt: string } }
      expect(inserted.input_data.prompt).toContain("young woman")
      expect(inserted.input_data.prompt).toContain("curly red hair")
    })

    it("weaves BOTH injectedAssets (P1) and facetInjections (P2) into the prompt", async () => {
      mockResolveFacetInjections.mockResolvedValueOnce("warm olive skin")
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "young woman",
          injectedAssets: "wearing a trench coat",
          facetInjections: [{ sourceText: "char 1 description", facet: "skin-tone" }],
        },
      })

      const inserted = insert.mock.calls[0][0] as { input_data: { prompt: string } }
      expect(inserted.input_data.prompt).toContain("wearing a trench coat")
      expect(inserted.input_data.prompt).toContain("warm olive skin")
    })

    it("weaves facet text on the legacy description path (no seedPrompt)", async () => {
      mockResolveFacetInjections.mockResolvedValueOnce("short black hair")
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          description: "tall woman",
          facetInjections: [{ sourceText: "char 1 description", facet: "hair" }],
        },
      })

      const inserted = insert.mock.calls[0][0] as { input_data: { prompt: string } }
      expect(inserted.input_data.prompt).toContain("tall woman")
      expect(inserted.input_data.prompt).toContain("short black hair")
    })

    it("keeps the raw facetInjections OUT of the persisted job input_data", async () => {
      mockResolveFacetInjections.mockResolvedValueOnce("curly red hair")
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "young woman",
          facetInjections: [{ sourceText: "char 1 description", facet: "hair" }],
        },
      })

      const inserted = insert.mock.calls[0][0] as { input_data: Record<string, unknown> }
      // Extracted result is in the prompt; the raw source array is not persisted.
      expect(inserted.input_data).not.toHaveProperty("facetInjections")
      expect(inserted.input_data.prompt).toContain("curly red hair")
    })

    it("rejects more than 20 facetInjections (Zod cap)", async () => {
      const many = Array.from({ length: 21 }, () => ({ sourceText: "x", facet: "full" }))
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: "y w", facetInjections: many },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    })
  })

  it("returns 500 when job insert fails on the first job (no credits reserved, no queue.add)", async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "DB down" } })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "x" },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    // No credits reserved and nothing enqueued when Phase 1 fails on job 0.
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("rollback on mid-batch insert failure (count=4, job 2 insert fails)", async () => {
    // Job 1 succeeds, job 2 fails — must delete the orphan job 1.
    const single = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "job-1" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "DB blip on job 2" } })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    const inFn = vi.fn().mockResolvedValue({ error: null })
    const del = vi.fn().mockReturnValue({ in: inFn })
    vi.mocked(supabase.from).mockReturnValue({ insert, delete: del } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "y w", count: 4 },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    // Phase 1 cleanup: job-1 deleted, Phase 2 never reached.
    expect(del).toHaveBeenCalledTimes(1)
    expect(inFn).toHaveBeenCalledWith("id", ["job-1"])
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
    expect(mockRefundCredits).not.toHaveBeenCalled()
  })

  it("rollback on mid-batch credit-reservation failure (count=4, job 2 reservation fails)", async () => {
    // Phase 1 inserts succeed for all 4 jobs; Phase 2A: reserveCredits succeeds for
    // job-1, then job-2's reservation fails (reply.sent set). Expect:
    //   - response = 402 from reserveCreditsForJob's mock
    //   - mockRefundCredits called once (job-1's log-1)
    //   - delete("id", ["job-3","job-4"]) — job-2 already deleted by reserveCreditsForJobImpl
    //   - videoQueue.add NEVER called (Phase 2B unreached)
    vi.mocked(reserveCreditsForJob)
      .mockResolvedValueOnce({ usageLogId: "log-1", creditsReserved: 6, watermark: false })
      .mockImplementationOnce(async (_req, reply) => {
        reply.status(402).send({ error: { code: "insufficient_credits" } })
        return undefined
      })

    const chain = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert: chain.insert,
      delete: chain.delete,
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "y w", count: 4 },
    })

    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_credits")
    // All 4 jobs inserted, but only 2 reservation attempts.
    expect(chain.insert).toHaveBeenCalledTimes(4)
    expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledTimes(2)
    // Refund the one reservation that succeeded.
    expect(mockRefundCredits).toHaveBeenCalledTimes(1)
    expect(mockRefundCredits).toHaveBeenCalledWith("log-1")
    // Orphan delete: jobs 3 & 4 (job-2 already deleted by reserveCreditsForJobImpl).
    expect(chain.delete).toHaveBeenCalledTimes(1)
    expect(chain.in).toHaveBeenCalledWith("id", ["job-3", "job-4"])
    // Critical: nothing enqueued — Phase 2B never reached.
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("enqueues videoQueue with provider, prompt, attachToCharacterId, usageLogId", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "young woman",
        provider: "nano-banana-pro",
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character",
      expect.objectContaining({
        jobId: "job-1",
        provider: "nano-banana-pro",
        attachToCharacterId: TEST_CHARACTER_ID,
        usageLogId: "log-1",
      }),
    )
  })

  // ───────────────────────────────────────────────────────────────────────
  // Credit-affecting quality/resolution levers (mirrors generate-image).
  // The DEBIT identifier (reserveCreditsForJob's 4th arg) must be the
  // composite id from the shared resolver — the same function the (mocked
  // no-op here) credit-guard CHECK runs, so asserting the DEBIT pins both.
  // ───────────────────────────────────────────────────────────────────────
  describe("quality / resolution levers", () => {
    it("quality=high + gpt-image reserves the composite id and threads levers to the queue", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "young woman",
          provider: "gpt-image",
          quality: "high",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), "job-1", "gpt-image:high",
      )
      expect(videoQueue.add).toHaveBeenCalledWith(
        "generate-character",
        expect.objectContaining({ quality: "high" }),
      )
    })

    it("resolution=4K + nano-banana-pro reserves 'nano-banana-pro:4K' and threads resolution", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "young woman",
          provider: "nano-banana-pro",
          resolution: "4K",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), "job-1", "nano-banana-pro:4K",
      )
      expect(videoQueue.add).toHaveBeenCalledWith(
        "generate-character",
        expect.objectContaining({ resolution: "4K" }),
      )
    })

    it("a quality the model doesn't support is ignored, not a 400 (nano-banana + high → base id)", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "young woman",
          provider: "nano-banana",
          quality: "high",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), "job-1", "nano-banana",
      )
    })

    it("omitting the levers keeps the legacy plain-provider identifier (cost unchanged)", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: "young woman", provider: "nano-banana-pro" },
      })

      expect(res.statusCode).toBe(200)
      expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), "job-1", "nano-banana-pro",
      )
    })

    it("a value outside the enum is rejected by Zod (validation_error)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: "y w", quality: "ultra" },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    })

    it("count=2 batch — every job reserves with the SAME composite id", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "y w",
          count: 2,
          provider: "gpt-image",
          quality: "high",
        },
      })

      expect(res.statusCode).toBe(200)
      expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledTimes(2)
      for (const call of vi.mocked(reserveCreditsForJob).mock.calls) {
        expect(call[3]).toBe("gpt-image:high")
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Per-asset-type aspect-ratio defaults — portrait defaults to 3:4.
  // Spec: explicit > characterNodeAspectRatio > per-asset-type default.
  // ───────────────────────────────────────────────────────────────────────
  describe("aspect-ratio defaults", () => {
    function getAspect(): string {
      const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      return enqueued.aspectRatio as string
    }

    it("portrait defaults to 3:4 when nothing is set", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)
      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: "young woman" },
      })
      expect(getAspect()).toBe("3:4")
    })

    it("characterNodeAspectRatio overrides the portrait default", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)
      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: "y w", characterNodeAspectRatio: "16:9" },
      })
      expect(getAspect()).toBe("16:9")
    })

    it("explicit aspectRatio beats characterNodeAspectRatio and the portrait default", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)
      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "y w",
          aspectRatio: "9:16",
          characterNodeAspectRatio: "16:9",
        },
      })
      expect(getAspect()).toBe("9:16")
    })

    it("invalid aspectRatio is rejected by Zod (validation_error)", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: "y w", aspectRatio: "21:9" },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    })

    it("count=2 batch — all jobs in the batch share the same resolved aspectRatio", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)
      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "y w",
          count: 2,
          characterNodeAspectRatio: "9:16",
        },
      })
      expect(vi.mocked(videoQueue.add)).toHaveBeenCalledTimes(2)
      const enqueued0 = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      const enqueued1 = vi.mocked(videoQueue.add).mock.calls[1][1] as Record<string, unknown>
      expect(enqueued0.aspectRatio).toBe("9:16")
      expect(enqueued1.aspectRatio).toBe("9:16")
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Per-job credit override — the N² over-charge regression guard (WI-3).
  //
  // The preHandler (creditGuardImpl) reserves the BATCH total
  // (base×count×markup) once on req.creditReservation.creditOverride. Without
  // the per-job correction, the N-call reservation loop reuses that batch
  // total for EVERY job, debiting batchTotal×N ≈ base×count²×markup.
  //
  // These tests inject a req.creditReservation seeded with the BATCH total
  // (mimicking the real preHandler), mock getModelCreditBaseCost + app
  // settings so the per-job math is deterministic, and record
  // req.creditReservation.creditOverride at each reserveCreditsForJob call.
  // The fix is proven iff every recorded value is the PER-JOB amount (not the
  // batch total) — i.e. Σ debited = N × perJob, NOT N².
  // ───────────────────────────────────────────────────────────────────────
  describe("per-job credit override (N² over-charge guard)", () => {
    // nano-banana base = 1 in the real catalog, but we mock a larger base so
    // perJob (5) ≠ batchTotal (50) is unambiguous. markup 25%, count 10:
    //   perJob     = ceil(4 × 1.25)      = 5
    //   batchTotal = ceil(4 × 10 × 1.25) = 50   (what the preHandler reserves)
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
        apps_auto_scroll_seconds: 4, nodaro_provider_prefs: null,
      })

      // reserveCreditsForJob records the override the route set for THIS call.
      vi.mocked(reserveCreditsForJob).mockImplementation(async (req: any) => {
        recordedOverrides.push(req.creditReservation?.creditOverride)
        return { usageLogId: `log-${recordedOverrides.length}`, creditsReserved: PER_JOB_OVERRIDE, watermark: false }
      })

      perJobApp = Fastify({ logger: false })
      // Auth hook + creditReservation seeded with the BATCH total, exactly as
      // the real creditGuardImpl would leave it for a count=N request.
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
        await generateCharacterRoutes(instance)
      })
      await perJobApp.ready()
    })

    afterEach(async () => {
      await perJobApp.close()
    })

    it("count=10: every reservation sees the per-job override, not the batch total", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      const res = await perJobApp.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID, "x-batch-count": "10" },
        payload: { name: "Kira", seedPrompt: "young woman", count: 10 },
      })

      expect(res.statusCode).toBe(200)
      expect(vi.mocked(reserveCreditsForJob)).toHaveBeenCalledTimes(10)
      // The regression: without the per-job reset, every entry would be 50
      // (the batch total) and the sum would be 500 (N²). With the fix every
      // entry is 5 (per-job) and the sum is 50 (N × perJob).
      expect(recordedOverrides).toEqual(Array(10).fill(PER_JOB_OVERRIDE))
      const totalDebited = recordedOverrides.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)
      expect(totalDebited).toBe(10 * PER_JOB_OVERRIDE) // 50, NOT 500
    })

    it("count=1: the single reservation also sees the per-job override", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      const res = await perJobApp.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID, "x-batch-count": "1" },
        payload: { name: "Kira", seedPrompt: "young woman" },
      })

      expect(res.statusCode).toBe(200)
      expect(recordedOverrides).toEqual([PER_JOB_OVERRIDE])
    })
  })

  // Placed immediately AFTER the block above on purpose: that block replaces
  // reserveCreditsForJob's implementation for its own tests, and this is what
  // proves the replacement does not outlive it.
  describe("module-mock isolation", () => {
    it("starts from the documented reserveCreditsForJob default, whatever an earlier block installed", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: "young woman" },
      })

      expect(res.statusCode).toBe(200)
      // The factory default is a fixed "log-1". The per-job block's recorder
      // returns log-<n> from a counter that keeps growing, so inheriting it
      // shows up here as log-2, log-3, … — a value that drifts with how many
      // tests ran before this one.
      const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(enqueued.usageLogId).toBe("log-1")
    })
  })
})

describe("skipPortraitAttach passthrough (auto-attach opt-out)", () => {
  it("threads skipPortraitAttach: true into the queue payload and input_data", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        seedPrompt: "young woman",
        attachToCharacterId: TEST_CHARACTER_ID,
        skipPortraitAttach: true,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character",
      expect.objectContaining({
        attachToCharacterId: TEST_CHARACTER_ID,
        skipPortraitAttach: true,
      }),
    )
    const inserted = insert.mock.calls[0][0] as { input_data: Record<string, unknown> }
    expect(inserted.input_data.skipPortraitAttach).toBe(true)
  })

  it("omitted flag stays undefined in the queue payload (default behavior preserved)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "young woman", attachToCharacterId: TEST_CHARACTER_ID },
    })

    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.skipPortraitAttach).toBeUndefined()
  })

  it("rejects a non-boolean skipPortraitAttach (validation_error)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "y w", skipPortraitAttach: "yes" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Row-description fallback (attach-and-regenerate). Rows whose portrait was
// deliberately deferred (extension-reimagine) persist the describe prose on
// `characters.description`; a later promptless generate with
// attachToCharacterId must seed a properly scaffolded portrait from it.
// ───────────────────────────────────────────────────────────────────────────
describe("row-description fallback (attach-and-regenerate)", () => {
  const ROW_DESCRIPTION =
    "- Subject: A tall knight in dented armor.\n- Setting: A misty castle courtyard."

  it("promptless body + attachToCharacterId seeds a scaffolded portrait from the row description", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert,
      ...charSelectChain({ person: null, wardrobe: null, description: ROW_DESCRIPTION }),
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", attachToCharacterId: TEST_CHARACTER_ID },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().jobIds).toHaveLength(1)
    const inserted = insert.mock.calls[0][0] as { input_data: { prompt: string } }
    expect(inserted.input_data.prompt).toContain("A tall knight in dented armor")
    // THROUGH buildPortraitPrompt — the regeneration is a portrait, not an
    // unscaffolded prose render.
    expect(inserted.input_data.prompt).toContain("studio lighting")
    expect(inserted.input_data.prompt).toContain("plain background")
  })

  it("promptless body + attach on a row with no description is a 400 (post-fetch refine completion)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", attachToCharacterId: TEST_CHARACTER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(insert).not.toHaveBeenCalled()
    expect(videoQueue.add).not.toHaveBeenCalled()
  })

  it("a whitespace-only row description does not satisfy the fallback (400)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert,
      ...charSelectChain({ person: null, wardrobe: null, description: "   " }),
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", attachToCharacterId: TEST_CHARACTER_ID },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("body description still wins over the row description (legacy verbatim path, no scaffolding)", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert,
      ...charSelectChain({ person: null, wardrobe: null, description: ROW_DESCRIPTION }),
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        name: "Kira",
        description: "short body prompt",
        attachToCharacterId: TEST_CHARACTER_ID,
      },
    })

    expect(res.statusCode).toBe(200)
    const inserted = insert.mock.calls[0][0] as { input_data: { prompt: string } }
    expect(inserted.input_data.prompt).toContain("short body prompt")
    expect(inserted.input_data.prompt).not.toContain("tall knight")
    expect(inserted.input_data.prompt).not.toContain("studio lighting")
  })

  it("promptless body WITHOUT attach still fails the schema refine (unchanged contract)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

// ---------------------------------------------------------------------------
// W1-a minor-age floor — the route decides the subject's age ONCE from the
// character row's `person` value and rides the decision to the worker.
// ---------------------------------------------------------------------------
describe("POST /v1/generate-character — minor-age floor (W1-a)", () => {
  it("adult byte-identity pin: the enqueued prompt is the pre-change string", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert,
      ...charSelectChain({ person: { age: "age-30s" }, wardrobe: null, description: null }),
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "young woman", attachToCharacterId: TEST_CHARACTER_ID },
    })

    expect(res.statusCode).toBe(200)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.prompt).toBe(`young woman, in their 30s. ${PORTRAIT_SCAFFOLDING}.`)
  })

  it("adult: subjectMinor rides the job as false", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert,
      ...charSelectChain({ person: { age: "age-30s" }, wardrobe: null, description: null }),
    } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "young woman", attachToCharacterId: TEST_CHARACTER_ID },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character",
      expect.objectContaining({ subjectMinor: false }),
    )
  })

  it("minor: subjectMinor rides the job as true and the scaffolding carries the modest clause once", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert,
      ...charSelectChain({ person: { age: "age-child", bust: "bust-full" }, wardrobe: null, description: null }),
    } as never)

    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "a child in a red coat", attachToCharacterId: TEST_CHARACTER_ID },
    })

    expect(res.statusCode).toBe(200)
    const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
    expect(enqueued.subjectMinor).toBe(true)
    const prompt = enqueued.prompt as string
    expect(prompt.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
    expect(prompt).not.toContain(CLOTHED_DEFAULT)
    // Layer 1 already dropped the flagged picker hint from the person value.
    expect(prompt).not.toMatch(/full bust/)
  })

  // ───────────────────────────────────────────────────────────────────────
  // The incident path. person.nodaro.ai creates the character row with
  // `{nodeId, name, projectId}` and never persists the picker `person` value,
  // so on arrival `row.person === null` and the ONLY age evidence is the
  // client-assembled seedPrompt. `isMinorAge` alone reads false here — which
  // is exactly how the 2026-07-30 prompt reached the provider un-floored.
  // ───────────────────────────────────────────────────────────────────────
  describe("row.person is null — the age lives only in the client-assembled text", () => {
    afterEach(() => clearPromptPolicies())

    const INCIDENT_SEED =
      "a young child around 5 years old, the clothing fitted and form-conscious, hugging the contours of the body, with lips slightly parted, taking a soft breath"

    it("INCIDENT REPRO: subjectMinor is true and the worker policy floors the prompt", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({
        insert,
        ...charSelectChain({ person: null, wardrobe: null, description: null }),
      } as never)

      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: INCIDENT_SEED, attachToCharacterId: TEST_CHARACTER_ID },
      })

      expect(res.statusCode).toBe(200)
      const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(enqueued.subjectMinor).toBe(true)

      // …and the floored job is auditable on the jobs row.
      const inserted = insert.mock.calls[0][0] as { input_data: Record<string, unknown> }
      expect(inserted.input_data.subjectMinor).toBe(true)

      // What the entity handler then does with it (same call, same args).
      registerMainlinePromptPolicies()
      const policed = applyPromptPolicies({
        prompt: enqueued.prompt as string,
        negativePrompt: "",
        kind: "image",
        subjectMinor: enqueued.subjectMinor === true,
      }).prompt

      expect(policed).not.toContain("hugging the contours")
      expect(policed).not.toContain("lips slightly parted")
      expect(policed).not.toContain(CLOTHED_DEFAULT)
      expect(policed.split(MODEST_ATTIRE_CLAUSE).length - 1).toBe(1)
      // The subject survives the repair.
      expect(policed).toContain("a young child around 5 years old")
    })

    it("ADULT MIRROR: the same prompt about an adult is untouched — subjectMinor false, prompt byte-identical", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({
        insert,
        ...charSelectChain({ person: null, wardrobe: null, description: null }),
      } as never)

      const adultSeed = INCIDENT_SEED.replace("a young child around 5 years old", "a woman in her 30s")
      const res = await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", seedPrompt: adultSeed, attachToCharacterId: TEST_CHARACTER_ID },
      })

      expect(res.statusCode).toBe(200)
      const enqueued = vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>
      expect(enqueued.subjectMinor).toBe(false)
      expect(enqueued.prompt).toBe(`${adultSeed}. ${PORTRAIT_SCAFFOLDING}.`)

      // The policy is the identity for an adult: the wording it would strip for
      // a minor stays exactly where the user put it.
      registerMainlinePromptPolicies()
      const policed = applyPromptPolicies({
        prompt: enqueued.prompt as string,
        negativePrompt: "",
        kind: "image",
        subjectMinor: enqueued.subjectMinor === true,
      }).prompt
      expect(policed).toBe(enqueued.prompt)
    })

    it("the text signal reads the legacy `description` field too (no seedPrompt at all)", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({
        insert,
        ...charSelectChain({ person: null, wardrobe: null, description: null }),
      } as never)

      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", description: "a 7 year old on a swing", attachToCharacterId: TEST_CHARACTER_ID },
      })

      expect(videoQueue.add).toHaveBeenCalledWith(
        "generate-character",
        expect.objectContaining({ subjectMinor: true }),
      )
    })

    it("the text signal reads the ROW's persisted description (deferred-portrait regen path)", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({
        insert,
        ...charSelectChain({ person: null, wardrobe: null, description: "a child around 8 years old, red raincoat" }),
      } as never)

      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: { name: "Kira", attachToCharacterId: TEST_CHARACTER_ID },
      })

      expect(videoQueue.add).toHaveBeenCalledWith(
        "generate-character",
        expect.objectContaining({ subjectMinor: true }),
      )
    })

    it("a bare mention of a child by an adult subject does NOT flip the floor", async () => {
      const { insert } = mockJobsInsertChain()
      vi.mocked(supabase.from).mockReturnValue({
        insert,
        ...charSelectChain({ person: null, wardrobe: null, description: null }),
      } as never)

      await app.inject({
        method: "POST",
        url: "/v1/generate-character",
        headers: { "x-user-id": TEST_USER_ID },
        payload: {
          name: "Kira",
          seedPrompt: "a mother in her 30s holding her child",
          attachToCharacterId: TEST_CHARACTER_ID,
        },
      })

      expect(videoQueue.add).toHaveBeenCalledWith(
        "generate-character",
        expect.objectContaining({ subjectMinor: false }),
      )
    })
  })

  it("minor: the legacy (non-scaffolded) prompt path still rides subjectMinor — the worker floor is its only cover", async () => {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({
      insert,
      ...charSelectChain({ person: { age: "age-child" }, wardrobe: null, description: null }),
    } as never)

    await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", description: "a child in a red coat", attachToCharacterId: TEST_CHARACTER_ID },
    })

    expect(videoQueue.add).toHaveBeenCalledWith(
      "generate-character",
      expect.objectContaining({ subjectMinor: true }),
    )
  })
})

// ---------------------------------------------------------------------------
// Catalog-snap parity: CHECK === DEBIT === input_data === queue payload
// ---------------------------------------------------------------------------
/**
 * `resolution` / `quality` are PRICING dimensions on this route (composite ids
 * like "gpt-image:high"), and the entity worker forwards both verbatim into
 * `extraParams`. So the catalog snap lives inside the ONE resolver the
 * preHandler CHECK and the handler DEBIT share — anything else splits the two,
 * and `commit_credits` never collects an upward delta (the reserve IS the
 * charge). `creditGuard` is mocked to a no-op here, so the CHECK is exercised
 * by calling that exact resolver directly on the same raw body.
 *
 * The assertion is four-way on purpose: a run that reserves one tier, records
 * another on the job row and sends a third to the provider is the exact bug
 * this block exists to make impossible.
 */
describe("POST /v1/generate-character — catalog snap parity", () => {
  async function run(payload: Record<string, unknown>) {
    const { insert } = mockJobsInsertChain()
    vi.mocked(supabase.from).mockReturnValue({ insert, ...charSelectChain() } as never)
    const res = await app.inject({
      method: "POST",
      url: "/v1/generate-character",
      headers: { "x-user-id": TEST_USER_ID },
      payload: { name: "Kira", seedPrompt: "young woman, designer glasses", ...payload },
    })
    expect(res.statusCode).toBe(200)
    return {
      check: resolveEntityImageParams({ name: "Kira", seedPrompt: "young woman, designer glasses", ...payload }).identifier,
      debit: vi.mocked(reserveCreditsForJob).mock.calls.at(-1)?.[3],
      inputData: (insert.mock.calls[0][0] as { input_data: Record<string, unknown> }).input_data,
      enqueued: vi.mocked(videoQueue.add).mock.calls[0][1] as Record<string, unknown>,
    }
  }

  it("snaps a quality gpt-image does not accept, everywhere at once", async () => {
    const { check, debit, inputData, enqueued } = await run({ provider: "gpt-image", quality: "basic" })
    expect(check).toBe(debit)
    // gpt-image declares ["medium", "high"]; "medium" is the base tier.
    expect(check).toBe("gpt-image")
    expect(inputData.quality).toBe("medium")
    expect(enqueued.quality).toBe("medium")
  })

  it("drops a resolution nano-banana does not have (never reaches the worker)", async () => {
    const { check, debit, inputData, enqueued } = await run({ provider: "nano-banana", resolution: "2K" })
    expect(check).toBe(debit)
    expect(check).toBe("nano-banana")
    expect(inputData.resolution).toBeUndefined()
    expect(enqueued.resolution).toBeUndefined()
  })

  it("leaves a catalog-valid pair byte-identical, composite price included", async () => {
    const { check, debit, inputData, enqueued } = await run({ provider: "gpt-image", quality: "high" })
    expect(check).toBe(debit)
    expect(check).toBe("gpt-image:high")
    expect(inputData.quality).toBe("high")
    expect(enqueued.quality).toBe("high")
  })

  it("never lets the snap erase the resolved aspect ratio", async () => {
    // aspectRatio is NOT a lever the entity snap owns — `resolveCharacterAspectRatio`
    // and the worker's per-model clamp do. A write-back that wiped it would
    // silently re-frame every character render.
    const { enqueued, inputData } = await run({ provider: "gpt-image", quality: "basic", aspectRatio: "16:9" })
    expect(enqueued.aspectRatio).toBe("16:9")
    expect(inputData.aspectRatio).toBe("16:9")
  })
})
