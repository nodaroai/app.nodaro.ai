import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TIER_STORAGE_LIMITS } from "../stripe-config.js"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, defaultRpc, tableResponses, ltCalls, setLastMatchedResponse, mockBatchDeleteFromR2, mockDeleteFromR2, mockUpdateStorageUsage } = vi.hoisted(() => {
  const tableResponses = new Map<string, Array<{ data: unknown; error: unknown }>>()
  const ltCalls: Array<{ table: string; col: unknown; val: unknown }> = []
  let lastMatchedResponse: { data: unknown; error: unknown } | null = null

  function shiftResponse(table: string): { data: unknown; error: unknown } {
    const queue = tableResponses.get(table)
    if (!queue || queue.length === 0) {
      return { data: null, error: null }
    }
    if (queue.length === 1) return queue[0]
    return queue.shift()!
  }

  function createChain(table: string) {
    const chain: Record<string, unknown> = {}
    let isReadChain = false

    const self = () => chain

    chain.select = vi.fn(() => { isReadChain = true; return chain })
    chain.eq = vi.fn(self)
    chain.neq = vi.fn(self)
    chain.or = vi.fn(self)
    chain.not = vi.fn(self)
    chain.is = vi.fn(self)
    chain.lt = vi.fn((col?: unknown, val?: unknown) => {
      ltCalls.push({ table, col, val })
      return chain
    })
    chain.gt = vi.fn(self)

    // .in() may be a terminal for read queries (select -> in) or a filter for writes
    chain.in = vi.fn(() => {
      if (isReadChain) {
        const resp = shiftResponse(table)
        return { ...chain, then: (resolve: (v: unknown) => void) => resolve(resp) }
      }
      return chain
    })

    chain.limit = vi.fn(() => {
      const resp = shiftResponse(table)
      return { ...chain, then: (resolve: (v: unknown) => void) => resolve(resp) }
    })
    chain.insert = vi.fn(self)
    chain.update = vi.fn(() => { isReadChain = false; return chain })
    chain.upsert = vi.fn(self)
    chain.single = vi.fn(() => Promise.resolve(shiftResponse(table)))

    // Default thenable for write operations
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null })

    return chain
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table))
  // The mark (`mark_job_outputs_cleaned`) marks every job it is handed; any
  // other function answers nothing.
  const defaultRpc = (fn: string, args?: { p_ids?: unknown[] }) =>
    Promise.resolve(fn === "mark_job_outputs_cleaned" ? { data: args?.p_ids?.length ?? 0, error: null } : { data: null, error: null })
  const mockRpc = vi.fn().mockImplementation(defaultRpc)
  const mockBatchDeleteFromR2 = vi.fn().mockResolvedValue({ deleted: 0, errors: 0 })
  const mockDeleteFromR2 = vi.fn().mockResolvedValue(undefined)
  const mockUpdateStorageUsage = vi.fn().mockResolvedValue(undefined)

  return {
    mockFrom,
    mockRpc,
    defaultRpc,
    tableResponses,
    ltCalls,
    setLastMatchedResponse: (v: { data: unknown; error: unknown } | null) => { lastMatchedResponse = v },
    mockBatchDeleteFromR2,
    mockDeleteFromR2,
    mockUpdateStorageUsage,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: mockFrom,
    auth: { getUser: vi.fn() },
    rpc: mockRpc,
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    R2_PUBLIC_URL: "https://cdn.example.com",
    R2_ACCOUNT_ID: "test-account",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET_NAME: "test-bucket",
  },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/storage.js", () => ({
  deleteFromR2: mockDeleteFromR2,
  batchDeleteFromR2: mockBatchDeleteFromR2,
}))

vi.mock("@/utils/file-validation.js", () => ({
  updateStorageUsage: mockUpdateStorageUsage,
}))

vi.mock("@/ee/billing/stripe-config.js", async () => {
  const actual = await vi.importActual<typeof import("../stripe-config.js")>("@/ee/billing/stripe-config.js")
  return actual
})

const mockLogTransaction = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockInvalidateBalanceCache = vi.hoisted(() => vi.fn())

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    logTransaction: mockLogTransaction,
  },
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: mockInvalidateBalanceCache,
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { withUrlsNulled } from "@/lib/job-output-keys.js"
import { expireSubscriptions, cleanupFreeUserMedia, cleanupCanceledUserMedia, renewSubscriptionCredits, sendStorageWarnings, sweepSoftDeletedLocationAssets } from "../cleanup-service.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every jobs row a test fed the reapers, by id: what `mark_job_outputs_cleaned` starts from. */
const fedJobOutputs = new Map<string, unknown>()

function mockTableQueue(table: string, responses: Array<{ data: unknown; error: unknown }>): void {
  tableResponses.set(table, [...responses])
  if (table !== "jobs") return
  for (const r of responses) {
    for (const row of Array.isArray(r.data) ? (r.data as Array<{ id?: string; output_data?: unknown }>) : []) {
      if (row.id) fedJobOutputs.set(row.id, row.output_data)
    }
  }
}

/**
 * What the reapers' mark writes (`mark_job_outputs_cleaned`, migration 495):
 * each marked job's output as fed, its deleted links nulled, plus `_cleaned` —
 * the database function's rule, applied here to the fed rows.
 */
function markedJobOutputs(): Array<Record<string, unknown>> {
  return mockRpc.mock.calls
    .filter((c) => c[0] === "mark_job_outputs_cleaned")
    .flatMap((c) => {
      const args = c[1] as { p_ids: string[]; p_urls: string[] }
      return args.p_ids.map((id) => {
        const nulled = withUrlsNulled(fedJobOutputs.get(id), new Set(args.p_urls))
        return nulled && typeof nulled === "object" && !Array.isArray(nulled)
          ? { ...(nulled as Record<string, unknown>), _cleaned: true }
          : { _cleaned: true, output: nulled }
      })
    })
}

function resetMocks(): void {
  tableResponses.clear()
  fedJobOutputs.clear()
  ltCalls.length = 0
  setLastMatchedResponse(null)
  mockFrom.mockClear()
  mockRpc.mockClear()
  mockBatchDeleteFromR2.mockClear()
  mockDeleteFromR2.mockClear()
  mockUpdateStorageUsage.mockClear()
  mockLogTransaction.mockClear()
  mockInvalidateBalanceCache.mockClear()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cleanup-service", () => {
  beforeEach(() => {
    resetMocks()
  })

  // ════════════════════════════════════════════════════════════════════════
  // expireSubscriptions
  // ════════════════════════════════════════════════════════════════════════

  describe("expireSubscriptions", () => {
    it("downgrades users past end date", async () => {
      // First query: canceled subscriptions past period end.
      // Second `subscriptions` read = the live-subscription re-check (returns
      // empty: neither user re-subscribed, so both are genuinely expired).
      mockTableQueue("subscriptions", [
        {
          data: [
            { id: "sub-1", user_id: "user-1", stripe_subscription_id: "ps-1" },
            { id: "sub-2", user_id: "user-2", stripe_subscription_id: "ps-2" },
          ],
          error: null,
        },
        { data: [], error: null }, // live-sub re-check: none active
      ])

      // Second query: profiles for those users (still on paid tiers)
      mockTableQueue("profiles", [
        {
          data: [
            { id: "user-1", tier: "pro" },
            { id: "user-2", tier: "basic" },
          ],
          error: null,
        },
      ])

      const result = await expireSubscriptions()

      expect(result.usersDowngraded).toBe(2)
      expect(result.errors).toBe(0)
    })

    it("does NOT downgrade a re-subscriber who has a stale canceled row AND a live active row", async () => {
      // BILLING-DATA-LOSS guard: the subscriptions table allows multiple rows per
      // user (the partial unique index forbids only two status='active' rows —
      // migration 024). After a cancel→re-subscribe, a stale 'canceled' row whose
      // period end is now in the past coexists with a fresh 'active' row, and the
      // profile is on the paid tier the re-subscribe restored. The candidate query
      // matches the STALE canceled row, so without the live-sub re-check this cron
      // would silently reset the paying customer to free / TIER_CREDITS.free / 1GB.
      //
      // First `subscriptions` read  -> the stale canceled candidate row.
      // Second `subscriptions` read -> the live-sub re-check finds the active row.
      mockTableQueue("subscriptions", [
        { data: [{ id: "sub-stale", user_id: "user-resub", stripe_subscription_id: "ps-old" }], error: null },
        { data: [{ user_id: "user-resub" }], error: null }, // live active row exists
      ])
      // Profile is still on the paid tier the re-subscribe restored.
      mockTableQueue("profiles", [
        { data: [{ id: "user-resub", tier: "pro" }], error: null },
      ])

      const result = await expireSubscriptions()

      // The re-subscriber must NOT be downgraded.
      expect(result.usersDowngraded).toBe(0)
      expect(result.errors).toBe(0)
    })

    it("downgrades a genuinely-expired user (only a stale canceled row, no live sub)", async () => {
      // Counterpart to the re-subscribe guard: a user with ONLY a stale canceled
      // row and NO live subscription IS the legitimate safety-net case and must
      // still be downgraded.
      mockTableQueue("subscriptions", [
        { data: [{ id: "sub-dead", user_id: "user-gone", stripe_subscription_id: "ps-dead" }], error: null },
        { data: [], error: null }, // live-sub re-check: none active
      ])
      mockTableQueue("profiles", [
        { data: [{ id: "user-gone", tier: "pro" }], error: null },
      ])

      const result = await expireSubscriptions()

      expect(result.usersDowngraded).toBe(1)
      expect(result.errors).toBe(0)
    })

    it("returns usersDowngraded: 0 when none expired", async () => {
      mockTableQueue("subscriptions", [
        { data: [], error: null },
      ])

      const result = await expireSubscriptions()

      expect(result.usersDowngraded).toBe(0)
      expect(result.errors).toBe(0)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // cleanupFreeUserMedia
  // ════════════════════════════════════════════════════════════════════════

  describe("cleanupFreeUserMedia", () => {
    it("deletes R2 files for expired free-tier assets", async () => {
      // Step 1: free users query
      mockTableQueue("profiles", [
        {
          data: [{ id: "free-user-1" }],
          error: null,
        },
      ])

      // Step 2: assets query (first batch returned, second empty to end loop)
      mockTableQueue("assets", [
        {
          data: [
            { id: "asset-1", user_id: "free-user-1", r2_key: "images/asset-1.png", size_bytes: 1024 },
            { id: "asset-2", user_id: "free-user-1", r2_key: "videos/asset-2.mp4", size_bytes: 2048 },
          ],
          error: null,
        },
      ])

      // Step 3: jobs query (empty — no job outputs to clean)
      mockTableQueue("jobs", [
        { data: [], error: null },
      ])

      mockBatchDeleteFromR2.mockResolvedValueOnce({ deleted: 2, errors: 0 })

      const result = await cleanupFreeUserMedia()

      expect(result.filesDeleted).toBe(2)
      expect(result.bytesFreed).toBe(3072)
      expect(result.errors).toBe(0)
      expect(mockBatchDeleteFromR2).toHaveBeenCalledWith([
        "images/asset-1.png",
        "videos/asset-2.mp4",
      ])
    })

    it("handles R2 deletion errors gracefully", async () => {
      mockTableQueue("profiles", [
        {
          data: [{ id: "free-user-1" }],
          error: null,
        },
      ])

      mockTableQueue("assets", [
        {
          data: [
            { id: "asset-1", user_id: "free-user-1", r2_key: "images/asset-1.png", size_bytes: 512 },
          ],
          error: null,
        },
      ])

      mockTableQueue("jobs", [
        { data: [], error: null },
      ])

      // Simulate partial R2 failure
      mockBatchDeleteFromR2.mockResolvedValueOnce({ deleted: 0, errors: 1 })

      const result = await cleanupFreeUserMedia()

      // Should not throw — errors are counted, not thrown
      expect(result.errors).toBe(1)
      expect(result.filesDeleted).toBe(0)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // sendStorageWarnings
  // ════════════════════════════════════════════════════════════════════════

  describe("sendStorageWarnings", () => {
    it("returns warning counts", async () => {
      const gb = 1024 * 1024 * 1024

      mockTableQueue("profiles", [
        {
          data: [
            // 85% usage — should trigger 80% warning
            { id: "user-1", email: "a@test.com", storage_used_bytes: 8.5 * gb, storage_limit_bytes: 10 * gb, tier: "basic" },
            // 97% usage — should trigger 95% warning
            { id: "user-2", email: "b@test.com", storage_used_bytes: 24.25 * gb, storage_limit_bytes: 25 * gb, tier: "standard" },
            // 100% usage — should trigger full warning
            { id: "user-3", email: "c@test.com", storage_used_bytes: 50 * gb, storage_limit_bytes: 50 * gb, tier: "pro" },
          ],
          error: null,
        },
      ])

      const result = await sendStorageWarnings()

      expect(result.warnings80).toBe(1)
      expect(result.warnings95).toBe(1)
      expect(result.warningsFull).toBe(1)
    })

    it("returns all zeros when no profiles found", async () => {
      mockTableQueue("profiles", [
        { data: [], error: null },
      ])
      const result = await sendStorageWarnings()
      expect(result.warnings80).toBe(0)
      expect(result.warnings95).toBe(0)
      expect(result.warningsFull).toBe(0)
    })

    it("returns all zeros on query error", async () => {
      mockTableQueue("profiles", [
        { data: null, error: { message: "query failed" } },
      ])
      const result = await sendStorageWarnings()
      expect(result.warnings80).toBe(0)
      expect(result.warnings95).toBe(0)
      expect(result.warningsFull).toBe(0)
    })

    it("skips profiles with limit <= 0", async () => {
      mockTableQueue("profiles", [
        {
          data: [
            { id: "user-1", email: "a@test.com", storage_used_bytes: 100, storage_limit_bytes: 0, tier: "free" },
          ],
          error: null,
        },
      ])
      const result = await sendStorageWarnings()
      expect(result.warnings80).toBe(0)
      expect(result.warnings95).toBe(0)
      expect(result.warningsFull).toBe(0)
    })

    it("does not warn for users below 80%", async () => {
      const gb = 1024 * 1024 * 1024
      mockTableQueue("profiles", [
        {
          data: [
            { id: "user-1", email: "a@test.com", storage_used_bytes: 5 * gb, storage_limit_bytes: 10 * gb, tier: "basic" }, // 50%
          ],
          error: null,
        },
      ])
      const result = await sendStorageWarnings()
      expect(result.warnings80).toBe(0)
      expect(result.warnings95).toBe(0)
      expect(result.warningsFull).toBe(0)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // cleanupCanceledUserMedia
  // ════════════════════════════════════════════════════════════════════════

  describe("cleanupCanceledUserMedia", () => {
    it("returns zeros when no expired users", async () => {
      mockTableQueue("profiles", [
        { data: [], error: null },
      ])
      const result = await cleanupCanceledUserMedia()
      expect(result.filesDeleted).toBe(0)
      expect(result.bytesFreed).toBe(0)
      expect(result.errors).toBe(0)
    })

    it("returns error on users query failure", async () => {
      mockTableQueue("profiles", [
        { data: null, error: { message: "query failed" } },
      ])
      const result = await cleanupCanceledUserMedia()
      expect(result.errors).toBe(1)
    })

    it("deletes assets and jobs for expired canceled users", async () => {
      // Step 1: expired users query
      mockTableQueue("profiles", [
        {
          data: [{ id: "user-expired", tier: "pro", subscription_tier: null }],
          error: null,
        },
      ])

      // Step 2: assets query (one batch then empty)
      mockTableQueue("assets", [
        {
          data: [
            { id: "asset-1", r2_key: "files/a.png", size_bytes: 2048 },
          ],
          error: null,
        },
        { data: [], error: null },
      ])

      // Step 3: jobs query (one batch with output then empty)
      mockTableQueue("jobs", [
        {
          data: [
            {
              id: "job-1",
              output_data: {
                videoUrl: "https://cdn.example.com/videos/job-1.mp4",
              },
            },
          ],
          error: null,
        },
        { data: [], error: null },
      ])

      mockBatchDeleteFromR2
        .mockResolvedValueOnce({ deleted: 1, errors: 0 }) // assets batch
        .mockResolvedValueOnce({ deleted: 1, errors: 0 }) // jobs batch

      const result = await cleanupCanceledUserMedia()
      expect(result.filesDeleted).toBe(2)
      expect(result.bytesFreed).toBe(2048)
      expect(result.errors).toBe(0)
    })

    it("reaps an authored Lottie JSON (output_data.lottieUrl) from a job row", async () => {
      // Phase 4 invariant guard (design F2): the motion-graphics-lottie handler
      // persists the authored Lottie under output_data.lottieUrl. The cleanup
      // sweep walks the whole output (lib/job-output-keys.ts) and reads every
      // url of ours, so the upload + sweep coverage land together. This
      // asserts the R2 key derived from output_data.lottieUrl reaches the
      // deletion batch.
      mockTableQueue("profiles", [
        { data: [{ id: "user-expired", tier: "pro", subscription_tier: null }], error: null },
      ])
      mockTableQueue("assets", [
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [
        {
          data: [
            {
              id: "job-lottie",
              output_data: {
                motionPlan: { planType: "lottie-graphic" },
                lottieUrl: "https://cdn.example.com/lottie/job-lottie.json",
              },
            },
          ],
          error: null,
        },
        { data: [], error: null },
      ])

      const allKeysSeen: string[] = []
      mockBatchDeleteFromR2.mockImplementation((keys: readonly string[]) => {
        allKeysSeen.push(...keys)
        return Promise.resolve({ deleted: keys.length, errors: 0 })
      })

      await cleanupCanceledUserMedia()

      expect(allKeysSeen).toContain("lottie/job-lottie.json")
    })

    it("SKIPS a candidate who still has an active subscription (never reaps a paying customer)", async () => {
      // Data-loss guard: a reactivated paying customer can be left with a stale
      // subscription_ended_at, so they match the candidate query (tier != free).
      // The safety check must skip them — deleting their media is irreversible.
      mockTableQueue("profiles", [
        { data: [{ id: "user-reactivated", tier: "pro", subscription_tier: "pro" }], error: null },
      ])
      // The new live-subscription re-check finds an active sub for that user.
      mockTableQueue("subscriptions", [
        { data: [{ user_id: "user-reactivated" }], error: null },
      ])

      const result = await cleanupCanceledUserMedia()

      expect(mockBatchDeleteFromR2).not.toHaveBeenCalled()
      expect(result.filesDeleted).toBe(0)
      expect(result.bytesFreed).toBe(0)
    })

    it("handles already cleaned job outputs (_cleaned flag)", async () => {
      mockTableQueue("profiles", [
        {
          data: [{ id: "user-expired", tier: "basic", subscription_tier: null }],
          error: null,
        },
      ])
      mockTableQueue("assets", [
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [
        {
          data: [
            {
              id: "job-1",
              output_data: { _cleaned: true, videoUrl: null },
            },
          ],
          error: null,
        },
        { data: [], error: null },
      ])

      const result = await cleanupCanceledUserMedia()
      // _cleaned jobs should be skipped
      expect(result.filesDeleted).toBe(0)
      expect(mockBatchDeleteFromR2).not.toHaveBeenCalled()
    })

    it("scans the locations table for R2 keys and deletes them (skips soft-deleted rows)", async () => {
      // Free-tier user with a single active location containing 6 R2 URLs across
      // source_image_url + 3 lighting variants + 2 reference photos.
      // A separate soft-deleted location MUST NOT have its keys scanned —
      // restore would then fail with broken URLs after cleanup runs.
      mockTableQueue("profiles", [
        {
          data: [{ id: "user-1", tier: "pro", subscription_tier: null }],
          error: null,
        },
      ])
      mockTableQueue("assets", [
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [
        { data: [], error: null },
      ])
      // Locations response: ONLY the active row (deleted_at IS NULL filter is
      // applied by the helper before this mock is hit; we model that by
      // returning only the row that should match the filter).
      mockTableQueue("locations", [
        {
          data: [
            {
              source_image_url: "https://cdn.example.com/locations/main.png",
              time_of_day: null,
              weather: null,
              seasons: null,
              angles: null,
              lighting: [
                { name: "morning", url: "https://cdn.example.com/locations/lighting-1.png" },
                { name: "noon",    url: "https://cdn.example.com/locations/lighting-2.png" },
                { name: "dusk",    url: "https://cdn.example.com/locations/lighting-3.png" },
              ],
              atmosphere_motions: null,
              reference_photos: [
                { kind: "mood",      url: "https://cdn.example.com/locations/ref-1.jpg" },
                { kind: "reference", url: "https://cdn.example.com/locations/ref-2.jpg" },
              ],
            },
          ],
          error: null,
        },
      ])

      // Track every key passed to batchDeleteFromR2 across all calls so we can
      // assert the location keys ended up in the batch regardless of where in
      // the cleanup pass they were flushed.
      const allKeysSeen: string[] = []
      mockBatchDeleteFromR2.mockImplementation((keys: readonly string[]) => {
        allKeysSeen.push(...keys)
        return Promise.resolve({ deleted: keys.length, errors: 0 })
      })

      await cleanupCanceledUserMedia()

      // All 6 R2 keys from the active location must be included
      expect(allKeysSeen).toEqual(
        expect.arrayContaining([
          "locations/main.png",
          "locations/lighting-1.png",
          "locations/lighting-2.png",
          "locations/lighting-3.png",
          "locations/ref-1.jpg",
          "locations/ref-2.jpg",
        ]),
      )
      expect(allKeysSeen.length).toBe(6)
    })

    it("terminates when a full BATCH_SIZE of _cleaned jobs returns (regression: was infinite loop)", async () => {
      // Without the SQL `.is("output_data->>_cleaned", null)` filter AND the
      // defensive `jobsToClean.length === 0` break, this scenario looped
      // forever: the mock kept returning 100 _cleaned jobs (jobs.length stays
      // at BATCH_SIZE so the < BATCH_SIZE termination never fires), the JS
      // skip prevented re-processing them, but the outer while never exited.
      // In production this hung the daily cleanup cron the moment any user
      // had ≥100 jobs that had already been marked _cleaned.
      mockTableQueue("profiles", [
        {
          data: [{ id: "user-stuck", tier: "pro", subscription_tier: null }],
          error: null,
        },
      ])
      mockTableQueue("assets", [
        { data: [], error: null },
      ])
      // Build a full batch (100 = BATCH_SIZE) of already-cleaned jobs.
      const cleanedBatch = Array.from({ length: 100 }, (_, i) => ({
        id: `job-${i}`,
        output_data: { _cleaned: true, videoUrl: null },
      }))
      mockTableQueue("jobs", [{ data: cleanedBatch, error: null }])

      // Bound the test so a regression manifests as a timeout failure rather
      // than hanging the whole vitest run forever.
      const result = await Promise.race([
        cleanupCanceledUserMedia(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("cleanupCanceledUserMedia did not terminate (infinite loop regression)")), 2000),
        ),
      ]) as Awaited<ReturnType<typeof cleanupCanceledUserMedia>>

      expect(result.filesDeleted).toBe(0)
      expect(mockBatchDeleteFromR2).not.toHaveBeenCalled()
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // A job artefact held INSIDE output_data (decided 2026-10-08): Speaker
  // Frames' node output is a descriptor `{ json: { url, sha256, bytes, … } }`
  // whose body lives at `speaker-tracks/<jobId>.json`. It expires exactly like
  // the job's other outputs, so both reapers must reach the nested url — and
  // only for a REGISTERED artefact prefix, in the job's own key family.
  // ════════════════════════════════════════════════════════════════════════

  describe("the whole job output is walked (decided 2026-10-08)", () => {
    // The reapers read a job's files off its WHOLE output — nested objects and
    // lists included — and delete only the ones in the job's own key family,
    // the rule the app expunge applies. A key a library row ties to another
    // job, or to no job, stays (expunge's guard).
    const JOB = "00000000-0000-4000-8000-0000000000aa"
    const OTHER = "00000000-0000-4000-8000-0000000000bb"
    const cdn = (key: string) => `https://cdn.example.com/${key}`
    const descriptorOutput = (id: string) => ({
      json: { version: 1, sources: [], url: cdn(`speaker-tracks/${id}.json`), sha256: "a".repeat(64), bytes: 10 },
      notes: [],
      stats: { sources: [] },
    })

    function captureDeletes(): string[] {
      const seen: string[] = []
      mockBatchDeleteFromR2.mockImplementation((keys: readonly string[]) => {
        seen.push(...keys)
        return Promise.resolve({ deleted: keys.length, errors: 0 })
      })
      return seen
    }

    function updatesOn(table: string): Array<Record<string, unknown>> {
      return mockFrom.mock.calls
        .map((c, i) => ({ table: c[0] as string, chain: mockFrom.mock.results[i]?.value as { update: { mock: { calls: unknown[][] } } } }))
        .filter((r) => r.table === table)
        .flatMap((r) => r.chain.update.mock.calls.map((u) => u[0] as Record<string, unknown>))
    }
    const jobUpdates = markedJobOutputs

    /** One free user with one aged job; `libraryRows` answers the library lookup. */
    function freeUserWithJob(output: Record<string, unknown>, libraryRows: unknown[] = [], libraryError: unknown = null): void {
      mockTableQueue("profiles", [{ data: [{ id: "free-user-1" }], error: null }])
      // Phase A1 reads `.in("user_id", …)` (a terminal in this mock) then
      // `.limit()`: two empty pages, then the library lookup's answer.
      mockTableQueue("assets", [
        { data: [], error: null },
        { data: [], error: null },
        { data: libraryRows, error: libraryError },
      ])
      // The jobs read is `.in` then `.limit()` too: one filler first.
      mockTableQueue("jobs", [
        { data: [], error: null },
        { data: [{ id: JOB, user_id: "free-user-1", output_data: output }], error: null },
        { data: [], error: null },
      ])
    }

    it("free-user expiry deletes a nested track file and clears its url from the descriptor", async () => {
      freeUserWithJob(descriptorOutput(JOB))
      const seen = captureDeletes()

      await cleanupFreeUserMedia()

      expect(seen).toContain(`speaker-tracks/${JOB}.json`)
      const updated = jobUpdates()
      expect(updated).toHaveLength(1)
      expect(updated[0]._cleaned).toBe(true)
      const json = updated[0].json as Record<string, unknown>
      expect(json.url).toBeNull()
      // The rest of the descriptor is left as it was.
      expect(json.sha256).toBe("a".repeat(64))
    })

    it("canceled-user expiry deletes a nested track file", async () => {
      mockTableQueue("profiles", [{ data: [{ id: "user-expired", tier: "pro", subscription_tier: null }], error: null }])
      mockTableQueue("assets", [{ data: [], error: null }])
      mockTableQueue("jobs", [
        { data: [{ id: JOB, output_data: descriptorOutput(JOB) }], error: null },
        { data: [], error: null },
      ])
      const seen = captureDeletes()

      await cleanupCanceledUserMedia()

      expect(seen).toContain(`speaker-tracks/${JOB}.json`)
    })

    it("reaches the job's own files under ANY prefix, nested in objects and lists — no registry", async () => {
      freeUserWithJob({
        result: { imageUrl: cdn(`images/${JOB}.png`) },
        variants: [{ url: cdn(`images/${JOB}-v1.png`) }, { url: cdn(`images/${JOB}-v2.png`) }],
        stems: { vocals: cdn(`audios/${JOB}-vocals.mp3`) },
      })
      const seen = captureDeletes()

      await cleanupFreeUserMedia()

      expect(seen).toEqual(
        expect.arrayContaining([`images/${JOB}.png`, `images/${JOB}-v1.png`, `images/${JOB}-v2.png`, `audios/${JOB}-vocals.mp3`]),
      )
      const [updated] = jobUpdates()
      expect((updated.result as Record<string, unknown>).imageUrl).toBeNull()
      expect(updated.variants).toEqual([{ url: null }, { url: null }])
      expect((updated.stems as Record<string, unknown>).vocals).toBeNull()
    })

    it("holds back a nested url outside the job's family (an echoed input) and leaves it in the output", async () => {
      const echoed = cdn(`images/${OTHER}.png`)
      freeUserWithJob({ imageUrl: cdn(`images/${JOB}.png`), json: { sources: [{ url: echoed }] }, sourceImageUrl: echoed })
      const seen = captureDeletes()

      await cleanupFreeUserMedia()

      expect(seen).toEqual([`images/${JOB}.png`])
      const [updated] = jobUpdates()
      expect(updated.imageUrl).toBeNull()
      // The echoed input is another object: its url stays while its file does.
      // That object's own row reaps it, and its deletion then blanks this url
      // too (`blank_job_output_urls`, decided 2026-10-08).
      expect(updated.sourceImageUrl).toBe(echoed)
      expect((updated.json as { sources: Array<{ url: string }> }).sources[0].url).toBe(echoed)
    })

    it("keeps a file a library row ties to another job or to no job, and leaves its url", async () => {
      const saved = cdn(`images/${JOB}-v1.png`)
      freeUserWithJob(
        { imageUrl: cdn(`images/${JOB}.png`), imageUrls: [cdn(`images/${JOB}.png`), saved] },
        [
          { r2_key: `images/${JOB}.png`, job_id: JOB }, // the job's own library row
          { r2_key: `images/${JOB}-v1.png`, job_id: null }, // a later gallery save of the variant
        ],
      )
      const seen = captureDeletes()

      await cleanupFreeUserMedia()

      expect(seen).toEqual([`images/${JOB}.png`])
      const [updated] = jobUpdates()
      expect(updated.imageUrl).toBeNull()
      expect(updated.imageUrls).toEqual([null, saved])
    })

    it("free-user expiry stops the batch, deleting nothing, when the library lookup fails", async () => {
      freeUserWithJob({ imageUrl: cdn(`images/${JOB}.png`) }, [], { message: "boom" })
      const seen = captureDeletes()

      const result = await cleanupFreeUserMedia()

      expect(seen).toEqual([])
      expect(jobUpdates()).toEqual([])
      expect(result.errors).toBeGreaterThan(0)
    })

    it("canceled-user expiry deletes nothing and does not downgrade when the library lookup fails", async () => {
      mockTableQueue("profiles", [{ data: [{ id: "user-expired", tier: "pro", subscription_tier: null }], error: null }])
      // The assets loop's one empty page, then the failed library lookup.
      mockTableQueue("assets", [
        { data: [], error: null },
        { data: null, error: { message: "boom" } },
      ])
      mockTableQueue("jobs", [
        { data: [{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }], error: null },
        { data: [], error: null },
      ])
      const seen = captureDeletes()

      const result = await cleanupCanceledUserMedia()

      expect(seen).toEqual([])
      expect(result.errors).toBeGreaterThan(0)
      expect(updatesOn("profiles").some((u) => u.storage_used_bytes === 0)).toBe(false)
    })
  })

  describe("shared files: blanking everywhere, and failed deletes recorded (decided 2026-10-08)", () => {
    // Round 10: a deleted file's link is blanked in EVERY job output that
    // names it, any owner (migration 495, through lib/job-output-references).
    // Round 12: there is no hold-back — a Seedance extend's raw .mov copy is
    // deleted with its job like any other own file; a later extend reads its
    // own copy (`videos/<its jobId>-raw-ref.mov`).
    const JOB = "00000000-0000-4000-8000-0000000000aa"
    const OTHER = "00000000-0000-4000-8000-0000000000bb"
    const cdn = (key: string) => `https://cdn.example.com/${key}`
    const RAW = cdn(`videos/${JOB}-raw.mov`)

    type RpcAnswer = { data: unknown; error: unknown }
    let blank: RpcAnswer
    /** The reapers' empty probe for migration 495 (`jobOutputBlankingAvailable`). */
    let probe: RpcAnswer
    let mark: RpcAnswer
    beforeEach(() => {
      blank = { data: 0, error: null }
      probe = { data: 0, error: null }
      mark = { data: undefined, error: null }
      mockRpc.mockReset()
      mockRpc.mockImplementation((fn: string, args?: { p_urls?: string[] }) => {
        if (fn === "blank_job_output_urls") return Promise.resolve(args?.p_urls?.length ? blank : probe)
        if (fn === "mark_job_outputs_cleaned") {
          // By default every job handed over is marked.
          return Promise.resolve(mark.data === undefined && !mark.error ? { data: (args as { p_ids?: unknown[] })?.p_ids?.length ?? 0, error: null } : mark)
        }
        return Promise.resolve({ data: null, error: null })
      })
    })
    afterEach(() => {
      mockRpc.mockReset()
      mockRpc.mockImplementation(defaultRpc)
    })

    const rpcCalls = (fn: string) =>
      mockRpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1] as { p_urls: string[] })
    const blanked = () => rpcCalls("blank_job_output_urls").flatMap((a) => a.p_urls)

    // Independent review round: the mark is ONE statement on each row's
    // current value, and nothing is deleted on a database without 495.
    it("marks the batch in the database from each row's current output — never a whole output written from the read", async () => {
      const video = cdn(`videos/${JOB}.mp4`)
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: video } }])
      captureDeletes()

      await cleanupFreeUserMedia()

      expect(updatesOn("jobs")).toEqual([])
      expect(rpcCalls("mark_job_outputs_cleaned")).toEqual([{ p_ids: [JOB], p_urls: [video] }])
    })

    it("canceled-user expiry marks through the database too", async () => {
      const video = cdn(`videos/${JOB}.mp4`)
      canceledUserWithJobs([{ id: JOB, output_data: { videoUrl: video } }])
      captureDeletes()

      await cleanupCanceledUserMedia()

      expect(updatesOn("jobs")).toEqual([])
      expect(rpcCalls("mark_job_outputs_cleaned")).toEqual([{ p_ids: [JOB], p_urls: [video] }])
    })

    it("a job whose output is not an object is still handed to the mark (or every run would select it again)", async () => {
      const video = cdn(`videos/${JOB}.mp4`)
      freeUserWithJobs([{ id: JOB, output_data: video as unknown as Record<string, unknown> }])
      const seen = captureDeletes()

      await cleanupFreeUserMedia()

      expect(seen).toEqual([`videos/${JOB}.mp4`])
      expect(rpcCalls("mark_job_outputs_cleaned")).toEqual([{ p_ids: [JOB], p_urls: [video] }])
      expect(jobUpdates()).toEqual([{ _cleaned: true, output: null }])
    })

    it("a batch the mark did not fully mark stops the pass rather than select it again", async () => {
      mark = { data: 0, error: null }
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      captureDeletes()

      await cleanupFreeUserMedia()

      expect(rpcCalls("mark_job_outputs_cleaned")).toHaveLength(1)
      expect(warn.mock.calls.some((c) => String(c[0]).includes("not marked cleaned"))).toBe(true)
      warn.mockRestore()
    })

    it("canceled-user expiry does not downgrade when the mark leaves a job unmarked", async () => {
      mark = { data: 0, error: null }
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      canceledUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      captureDeletes()

      await cleanupCanceledUserMedia()

      expect(updatesOn("profiles").some((u) => u.storage_used_bytes === 0)).toBe(false)
      warn.mockRestore()
    })

    it("a failed mark is an error, and stops the batch loop", async () => {
      mark = { data: null, error: { message: "boom" } }
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      captureDeletes()

      const result = await cleanupFreeUserMedia()

      expect(result.errors).toBeGreaterThan(0)
      expect(rpcCalls("mark_job_outputs_cleaned")).toHaveLength(1)
    })

    it("canceled-user expiry does not downgrade when the mark fails", async () => {
      mark = { data: null, error: { message: "boom" } }
      canceledUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      captureDeletes()

      const result = await cleanupCanceledUserMedia()

      expect(result.errors).toBeGreaterThan(0)
      expect(updatesOn("profiles").some((u) => u.storage_used_bytes === 0)).toBe(false)
    })

    it.each(["PGRST202", "42883"])(
      "on a database without migration 495 (%s, staging ahead of main) the free reaper deletes and marks no job file",
      async (code) => {
        probe = { data: null, error: { code, message: "missing" } }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
        const seen = captureDeletes()

        const result = await cleanupFreeUserMedia()

        expect(seen).toEqual([])
        expect(rpcCalls("mark_job_outputs_cleaned")).toEqual([])
        expect(blanked()).toEqual([])
        expect(result.errors).toBe(0)
        warn.mockRestore()
      },
    )

    it("on a database without migration 495 the canceled reaper deletes no job file and does not downgrade", async () => {
      probe = { data: null, error: { code: "PGRST202", message: "missing" } }
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      canceledUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      const seen = captureDeletes()

      await cleanupCanceledUserMedia()

      expect(seen).not.toContain(`videos/${JOB}.mp4`)
      expect(rpcCalls("mark_job_outputs_cleaned")).toEqual([])
      expect(updatesOn("profiles").some((u) => u.storage_used_bytes === 0)).toBe(false)
      warn.mockRestore()
    })

    it("a failed probe is an error, and deletes no job file", async () => {
      probe = { data: null, error: { code: "57014", message: "timeout" } }
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      const seen = captureDeletes()

      const result = await cleanupFreeUserMedia()

      expect(seen).toEqual([])
      expect(result.errors).toBeGreaterThan(0)
    })

    function captureDeletes(): string[] {
      const seen: string[] = []
      mockBatchDeleteFromR2.mockImplementation((keys: readonly string[]) => {
        seen.push(...keys)
        return Promise.resolve({ deleted: keys.length, errors: 0 })
      })
      return seen
    }

    function updatesOn(table: string): Array<Record<string, unknown>> {
      return mockFrom.mock.calls
        .map((c, i) => ({ table: c[0] as string, chain: mockFrom.mock.results[i]?.value as { update: { mock: { calls: unknown[][] } } } }))
        .filter((r) => r.table === table)
        .flatMap((r) => r.chain.update.mock.calls.map((u) => u[0] as Record<string, unknown>))
    }
    const jobUpdates = markedJobOutputs

    /** One free user with aged jobs in one batch; no library rows. */
    function freeUserWithJobs(rows: Array<{ id: string; output_data: Record<string, unknown> }>): void {
      mockTableQueue("profiles", [{ data: [{ id: "free-user-1" }], error: null }])
      mockTableQueue("assets", [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [
        { data: [], error: null },
        { data: rows.map((r) => ({ ...r, user_id: "free-user-1" })), error: null },
        { data: [], error: null },
      ])
    }

    function canceledUserWithJobs(rows: Array<{ id: string; output_data: Record<string, unknown> }>): void {
      mockTableQueue("profiles", [{ data: [{ id: "user-expired", tier: "pro", subscription_tier: null }], error: null }])
      mockTableQueue("assets", [{ data: [], error: null }])
      mockTableQueue("jobs", [
        { data: rows, error: null },
        { data: [], error: null },
      ])
    }

    it("deletes the raw extension copy with its job, like any other own file — no hold-back question", async () => {
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`), rawExtensionUrl: RAW } }])
      const seen = captureDeletes()

      await cleanupFreeUserMedia()

      expect(seen.sort()).toEqual([`videos/${JOB}-raw.mov`, `videos/${JOB}.mp4`])
      const [updated] = jobUpdates()
      expect(updated.rawExtensionUrl).toBeNull()
      expect(blanked().sort()).toEqual([RAW, cdn(`videos/${JOB}.mp4`)].sort())
    })

    it("blanks exactly the deleted files' urls everywhere — never a held-back echo", async () => {
      const echoed = cdn(`images/${OTHER}.png`)
      freeUserWithJobs([{ id: JOB, output_data: { imageUrl: cdn(`images/${JOB}.png`), sourceImageUrl: echoed } }])
      captureDeletes()

      await cleanupFreeUserMedia()

      expect(blanked()).toEqual([cdn(`images/${JOB}.png`)])
      const [updated] = jobUpdates()
      expect(updated.sourceImageUrl).toBe(echoed)
    })

    it("a link to another batch job's deleted file is blanked in its own update too (never written back)", async () => {
      const aFile = cdn(`videos/${JOB}.mp4`)
      const bFile = cdn(`videos/${OTHER}.mp4`)
      freeUserWithJobs([
        { id: JOB, output_data: { videoUrl: aFile, json: { sources: [{ url: bFile }] } } },
        { id: OTHER, output_data: { videoUrl: bFile } },
      ])
      captureDeletes()

      await cleanupFreeUserMedia()

      const updates = jobUpdates()
      const a = updates.find((u) => u.videoUrl === null && "json" in u)!
      expect((a.json as { sources: Array<{ url: unknown }> }).sources[0].url).toBeNull()
      expect(blanked().sort()).toEqual([aFile, bFile].sort())
    })

    it("blanks before it marks: when the blanking fails, the batch's jobs stay unmarked for the next run", async () => {
      blank = { data: null, error: { message: "boom" } }
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      captureDeletes()

      const result = await cleanupFreeUserMedia()

      expect(jobUpdates()).toEqual([])
      expect(result.errors).toBeGreaterThan(0)
    })

    it("canceled-user expiry blanks the deleted file's link everywhere, its own output included", async () => {
      canceledUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`), rawExtensionUrl: RAW } }])
      const seen = captureDeletes()

      await cleanupCanceledUserMedia()

      expect(seen.sort()).toEqual([`videos/${JOB}-raw.mov`, `videos/${JOB}.mp4`])
      expect(blanked().sort()).toEqual([RAW, cdn(`videos/${JOB}.mp4`)].sort())
      const [updated] = jobUpdates()
      expect(updated.videoUrl).toBeNull()
      expect(updated.rawExtensionUrl).toBeNull()
      expect(updated._cleaned).toBe(true)
      expect(rpcCalls("job_output_urls_still_referenced")).toEqual([])
    })

    // Review round 10 (F1): only a file storage confirms gone loses its links.
    function failDeletesOf(failing: readonly string[]): string[] {
      const seen: string[] = []
      mockBatchDeleteFromR2.mockImplementation((keys: readonly string[]) => {
        seen.push(...keys)
        const notDeleted = keys.filter((k) => failing.includes(k))
        return Promise.resolve({ deleted: keys.length - notDeleted.length, errors: notDeleted.length, notDeleted })
      })
      return seen
    }

    it("a file storage failed to delete keeps its link everywhere: not blanked, kept in its own output", async () => {
      const video = cdn(`videos/${JOB}.mp4`)
      const thumb = cdn(`thumbnails/${JOB}.jpg`)
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: video, thumbnailUrl: thumb } }])
      const seen = failDeletesOf([`videos/${JOB}.mp4`])

      const result = await cleanupFreeUserMedia()

      expect(seen.sort()).toEqual([`thumbnails/${JOB}.jpg`, `videos/${JOB}.mp4`])
      expect(blanked()).toEqual([thumb])
      const [updated] = jobUpdates()
      expect(updated.videoUrl).toBe(video)
      expect(updated.thumbnailUrl).toBeNull()
      expect(result.errors).toBeGreaterThan(0)
    })

    it("a whole failed delete blanks nothing anywhere", async () => {
      const video = cdn(`videos/${JOB}.mp4`)
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: video } }])
      failDeletesOf([`videos/${JOB}.mp4`])

      await cleanupFreeUserMedia()

      // Only the empty probe for migration 495: no url is blanked.
      expect(blanked()).toEqual([])
      const [updated] = jobUpdates()
      expect(updated.videoUrl).toBe(video)
    })

    it("canceled-user expiry keeps the link of a file storage failed to delete", async () => {
      const video = cdn(`videos/${JOB}.mp4`)
      const thumb = cdn(`thumbnails/${JOB}.jpg`)
      canceledUserWithJobs([{ id: JOB, output_data: { videoUrl: video, thumbnailUrl: thumb } }])
      failDeletesOf([`videos/${JOB}.mp4`])

      await cleanupCanceledUserMedia()

      expect(blanked()).toEqual([thumb])
      const [updated] = jobUpdates()
      expect(updated.videoUrl).toBe(video)
      expect(updated.thumbnailUrl).toBeNull()
    })

    // Review round 11 (decided 2026-10-08): the job is still marked cleaned,
    // and the files that failed are recorded for a later retry pass.
    function upsertsOn(table: string): unknown[][] {
      return mockFrom.mock.calls
        .map((c, i) => ({ table: c[0] as string, chain: mockFrom.mock.results[i]?.value as { upsert: { mock: { calls: unknown[][] } } } }))
        .filter((r) => r.table === table)
        .flatMap((r) => r.chain.upsert.mock.calls)
    }

    it("a file storage failed to delete is recorded for a retry as retention, and the job is still marked cleaned", async () => {
      const video = cdn(`videos/${JOB}.mp4`)
      const thumb = cdn(`thumbnails/${JOB}.jpg`)
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: video, thumbnailUrl: thumb } }])
      failDeletesOf([`videos/${JOB}.mp4`])

      await cleanupFreeUserMedia()

      expect(upsertsOn("storage_delete_retries")).toEqual([
        [[expect.objectContaining({ r2_key: `videos/${JOB}.mp4`, url: video, source: "retention", job_id: JOB })], { onConflict: "r2_key" }],
      ])
      const [updated] = jobUpdates()
      expect(updated._cleaned).toBe(true)
    })

    it("canceled-user expiry records a failed delete as retention too", async () => {
      const video = cdn(`videos/${JOB}.mp4`)
      canceledUserWithJobs([{ id: JOB, output_data: { videoUrl: video } }])
      failDeletesOf([`videos/${JOB}.mp4`])

      await cleanupCanceledUserMedia()

      expect(upsertsOn("storage_delete_retries")).toEqual([
        [[expect.objectContaining({ r2_key: `videos/${JOB}.mp4`, url: video, source: "retention", job_id: JOB })], { onConflict: "r2_key" }],
      ])
      expect(jobUpdates()[0]._cleaned).toBe(true)
    })

    it("records nothing when every delete succeeds", async () => {
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      captureDeletes()

      await cleanupFreeUserMedia()

      expect(upsertsOn("storage_delete_retries")).toEqual([])
    })

    it("when the failure cannot be recorded, the batch stays unmarked so the next run deletes again", async () => {
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      failDeletesOf([`videos/${JOB}.mp4`])
      const realFrom = mockFrom.getMockImplementation()!
      mockFrom.mockImplementation((table: string) => {
        const chain = realFrom(table) as Record<string, unknown>
        if (table === "storage_delete_retries") {
          chain.upsert = vi.fn(() => ({ then: (r: (v: unknown) => void) => r({ data: null, error: { code: "57014", message: "timeout" } }) }))
        }
        return chain
      })

      const result = await cleanupFreeUserMedia()

      expect(jobUpdates()).toEqual([])
      expect(result.errors).toBeGreaterThan(0)
      mockFrom.mockImplementation(realFrom)
    })

    it("on a database without the record yet (staging ahead of main), the batch is marked as before", async () => {
      freeUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      failDeletesOf([`videos/${JOB}.mp4`])
      const realFrom = mockFrom.getMockImplementation()!
      mockFrom.mockImplementation((table: string) => {
        const chain = realFrom(table) as Record<string, unknown>
        if (table === "storage_delete_retries") {
          chain.upsert = vi.fn(() => ({ then: (r: (v: unknown) => void) => r({ data: null, error: { code: "PGRST205", message: "no table" } }) }))
        }
        return chain
      })

      await cleanupFreeUserMedia()

      expect(jobUpdates()[0]._cleaned).toBe(true)
      mockFrom.mockImplementation(realFrom)
    })

    // Round 12 (decided 2026-10-08): every cleanup path records what storage
    // did not delete — assets and locations too — instead of dropping the key.
    // Round 3 (decided 2026-10-09): the free-user reaper and the canceled-user
    // wipe record every failure as "retention", retried with no job-link guard;
    // the soft-deleted location sweep finishes the user's own delete
    // ("location").
    function failingDeletes(failing: readonly string[]): void {
      mockBatchDeleteFromR2.mockImplementation((keys: readonly string[]) => {
        const notDeleted = keys.filter((k) => failing.includes(k))
        return Promise.resolve({ deleted: keys.length - notDeleted.length, errors: notDeleted.length, notDeleted, kept: [] })
      })
    }
    const recorded = () =>
      upsertsOn("storage_delete_retries").flatMap((c) => c[0] as Array<Record<string, unknown>>)

    it("free-user asset expiry records a failed delete as retention, and still clears the row", async () => {
      mockTableQueue("profiles", [{ data: [{ id: "free-user-1" }], error: null }])
      // The free-user read is `.in` (a terminal in this mock) then `.limit()`: one filler first.
      mockTableQueue("assets", [
        { data: [], error: null },
        { data: [{ id: "asset-1", user_id: "free-user-1", r2_key: "images/asset-1.png", size_bytes: 10 }], error: null },
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [{ data: [], error: null }])
      failingDeletes(["images/asset-1.png"])

      await cleanupFreeUserMedia()

      expect(recorded()).toEqual([
        expect.objectContaining({ r2_key: "images/asset-1.png", url: cdn("images/asset-1.png"), source: "retention", job_id: null }),
      ])
      expect(updatesOn("assets")).toContainEqual({ r2_key: null, r2_url: null })
    })

    it("free-user asset expiry leaves the rows keyed when the failure cannot be recorded", async () => {
      mockTableQueue("profiles", [{ data: [{ id: "free-user-1" }], error: null }])
      // The free-user read is `.in` (a terminal in this mock) then `.limit()`: one filler first.
      mockTableQueue("assets", [
        { data: [], error: null },
        { data: [{ id: "asset-1", user_id: "free-user-1", r2_key: "images/asset-1.png", size_bytes: 10 }], error: null },
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [{ data: [], error: null }])
      failingDeletes(["images/asset-1.png"])
      const realFrom = mockFrom.getMockImplementation()!
      mockFrom.mockImplementation((table: string) => {
        const chain = realFrom(table) as Record<string, unknown>
        if (table === "storage_delete_retries") {
          chain.upsert = vi.fn(() => ({ then: (r: (v: unknown) => void) => r({ data: null, error: { code: "57014", message: "timeout" } }) }))
        }
        return chain
      })

      const result = await cleanupFreeUserMedia()

      expect(updatesOn("assets")).toEqual([])
      expect(result.errors).toBeGreaterThan(0)
      mockFrom.mockImplementation(realFrom)
    })

    it("canceled-user asset expiry records a failed delete as retention", async () => {
      mockTableQueue("profiles", [{ data: [{ id: "user-expired", tier: "pro", subscription_tier: null }], error: null }])
      mockTableQueue("assets", [
        { data: [{ id: "asset-1", r2_key: "videos/asset-1.mp4", size_bytes: 10 }], error: null },
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [{ data: [], error: null }])
      failingDeletes(["videos/asset-1.mp4"])

      await cleanupCanceledUserMedia()

      expect(recorded()).toEqual([
        expect.objectContaining({ r2_key: "videos/asset-1.mp4", url: cdn("videos/asset-1.mp4"), source: "retention", job_id: null }),
      ])
    })

    const LOCATION_ROW = {
      source_image_url: cdn("locations/main.png"),
      time_of_day: null, weather: null, seasons: null, angles: null, lighting: null,
      atmosphere_motions: null, reference_photos: null,
    }

    it("free-user location expiry records a failed delete as retention", async () => {
      mockTableQueue("profiles", [{ data: [{ id: "free-user-1" }], error: null }])
      mockTableQueue("assets", [{ data: [], error: null }])
      mockTableQueue("jobs", [{ data: [], error: null }])
      mockTableQueue("locations", [{ data: [LOCATION_ROW], error: null }])
      failingDeletes(["locations/main.png"])

      await cleanupFreeUserMedia()

      expect(recorded()).toEqual([
        expect.objectContaining({ r2_key: "locations/main.png", url: cdn("locations/main.png"), source: "retention", job_id: null }),
      ])
    })

    it("canceled-user location expiry records a failed delete as retention, and does not downgrade when it cannot", async () => {
      mockTableQueue("profiles", [{ data: [{ id: "user-expired", tier: "pro", subscription_tier: null }], error: null }])
      mockTableQueue("assets", [{ data: [], error: null }])
      mockTableQueue("jobs", [{ data: [], error: null }])
      mockTableQueue("locations", [{ data: [LOCATION_ROW], error: null }])
      failingDeletes(["locations/main.png"])

      await cleanupCanceledUserMedia()
      expect(recorded()).toEqual([
        expect.objectContaining({ r2_key: "locations/main.png", url: cdn("locations/main.png"), source: "retention", job_id: null }),
      ])
      expect(updatesOn("profiles").some((u) => u.storage_used_bytes === 0)).toBe(true)

      resetMocks()
      mockTableQueue("profiles", [{ data: [{ id: "user-expired", tier: "pro", subscription_tier: null }], error: null }])
      mockTableQueue("assets", [{ data: [], error: null }])
      mockTableQueue("jobs", [{ data: [], error: null }])
      mockTableQueue("locations", [{ data: [LOCATION_ROW], error: null }])
      failingDeletes(["locations/main.png"])
      const realFrom = mockFrom.getMockImplementation()!
      mockFrom.mockImplementation((table: string) => {
        const chain = realFrom(table) as Record<string, unknown>
        if (table === "storage_delete_retries") {
          chain.upsert = vi.fn(() => ({ then: (r: (v: unknown) => void) => r({ data: null, error: { code: "57014", message: "timeout" } }) }))
        }
        return chain
      })
      const result = await cleanupCanceledUserMedia()
      expect(updatesOn("profiles").some((u) => u.storage_used_bytes === 0)).toBe(false)
      expect(result.errors).toBeGreaterThan(0)
      mockFrom.mockImplementation(realFrom)
    })

    it("the soft-deleted location sweep records a failed delete as a location delete and still marks the row purged", async () => {
      mockTableQueue("locations", [{ data: [{ id: "loc-1", user_id: "user-1", ...LOCATION_ROW }], error: null }])
      failingDeletes(["locations/main.png"])

      const result = await sweepSoftDeletedLocationAssets()

      expect(recorded()).toEqual([
        expect.objectContaining({ r2_key: "locations/main.png", url: cdn("locations/main.png"), source: "location", job_id: null }),
      ])
      expect(result.r2KeysDeleted).toBe(0)
      expect(updatesOn("locations").some((u) => typeof u.r2_assets_purged_at === "string")).toBe(true)
    })

    it("an archived site asset storage keeps on purpose is never recorded", async () => {
      mockTableQueue("locations", [{ data: [{ id: "loc-1", user_id: "user-1", ...LOCATION_ROW }], error: null }])
      mockBatchDeleteFromR2.mockImplementation((keys: readonly string[]) =>
        Promise.resolve({ deleted: 0, errors: 0, notDeleted: [...keys], kept: [...keys] }),
      )

      await sweepSoftDeletedLocationAssets()

      expect(recorded()).toEqual([])
    })

    it("canceled-user expiry does not downgrade, and marks nothing, when the blanking fails", async () => {
      blank = { data: null, error: { message: "boom" } }
      canceledUserWithJobs([{ id: JOB, output_data: { videoUrl: cdn(`videos/${JOB}.mp4`) } }])
      captureDeletes()

      const result = await cleanupCanceledUserMedia()

      expect(jobUpdates()).toEqual([])
      expect(result.errors).toBeGreaterThan(0)
      expect(updatesOn("profiles").some((u) => u.storage_used_bytes === 0)).toBe(false)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // renewSubscriptionCredits
  // ════════════════════════════════════════════════════════════════════════

  describe("renewSubscriptionCredits", () => {
    it("returns zeros when no renewable subscriptions", async () => {
      mockTableQueue("subscriptions", [
        { data: [], error: null },
      ])
      const result = await renewSubscriptionCredits()
      expect(result.usersRenewed).toBe(0)
      expect(result.errors).toBe(0)
    })

    it("returns error on query failure", async () => {
      mockTableQueue("subscriptions", [
        { data: null, error: { message: "query failed" } },
      ])
      const result = await renewSubscriptionCredits()
      expect(result.errors).toBe(1)
    })

    it("renews credits for users whose period has ended", async () => {
      mockTableQueue("subscriptions", [
        {
          data: [
            {
              id: "sub-1",
              user_id: "user-1",
              tier: "pro",
              current_period_end: "2026-01-01T00:00:00Z",
            },
          ],
          error: null,
        },
      ])

      // Batch profile fetch: credits_reset_at is before period end
      mockTableQueue("profiles", [
        {
          data: [
            { id: "user-1", credits_reset_at: "2025-12-01T00:00:00Z" },
          ],
          error: null,
        },
      ])

      const result = await renewSubscriptionCredits()
      expect(result.usersRenewed).toBe(1)
      expect(result.errors).toBe(0)
      expect(mockLogTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          creditType: "subscription",
          source: "subscription_renewal",
        })
      )
      expect(mockInvalidateBalanceCache).toHaveBeenCalledWith("user-1")
    })

    it("skips users already renewed (credits_reset_at >= period_end)", async () => {
      mockTableQueue("subscriptions", [
        {
          data: [
            {
              id: "sub-1",
              user_id: "user-1",
              tier: "basic",
              current_period_end: "2026-01-01T00:00:00Z",
            },
          ],
          error: null,
        },
      ])

      mockTableQueue("profiles", [
        {
          data: [
            { id: "user-1", credits_reset_at: "2026-01-15T00:00:00Z" }, // already renewed
          ],
          error: null,
        },
      ])

      const result = await renewSubscriptionCredits()
      expect(result.usersRenewed).toBe(0)
      expect(mockLogTransaction).not.toHaveBeenCalled()
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // expireSubscriptions — edge cases
  // ════════════════════════════════════════════════════════════════════════

  describe("expireSubscriptions — edge cases", () => {
    it("returns error on query failure", async () => {
      mockTableQueue("subscriptions", [
        { data: null, error: { message: "db error" } },
      ])
      const result = await expireSubscriptions()
      expect(result.errors).toBe(1)
      expect(result.usersDowngraded).toBe(0)
    })

    it("skips users already on free tier", async () => {
      mockTableQueue("subscriptions", [
        {
          data: [
            { id: "sub-1", user_id: "user-1", stripe_subscription_id: "ps-1" },
          ],
          error: null,
        },
        { data: [], error: null }, // live-sub re-check: none active
      ])
      // Profile already on free tier — webhook already handled
      mockTableQueue("profiles", [
        {
          data: [{ id: "user-1", tier: "free" }],
          error: null,
        },
      ])
      const result = await expireSubscriptions()
      expect(result.usersDowngraded).toBe(0)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // cleanupFreeUserMedia — additional edge cases
  // ════════════════════════════════════════════════════════════════════════

  describe("cleanupFreeUserMedia — edge cases", () => {
    it("returns zeros when no free users", async () => {
      mockTableQueue("profiles", [
        { data: [], error: null },
      ])
      const result = await cleanupFreeUserMedia()
      expect(result.filesDeleted).toBe(0)
      expect(result.bytesFreed).toBe(0)
      expect(result.errors).toBe(0)
    })

    it("returns error when free users query fails", async () => {
      mockTableQueue("profiles", [
        { data: null, error: { message: "profiles query failed" } },
      ])
      const result = await cleanupFreeUserMedia()
      expect(result.errors).toBe(1)
    })

    it("cleans job output R2 files", async () => {
      mockTableQueue("profiles", [
        { data: [{ id: "free-user-1" }], error: null },
      ])
      // No assets to clean — need 2 responses: one at .in() terminal, one at .limit()
      mockTableQueue("assets", [
        { data: [], error: null },
        { data: [], error: null },
      ])
      // Jobs with R2 output URLs — need enough responses for both .in() and .limit() terminals
      mockTableQueue("jobs", [
        {
          data: [
            {
              id: "job-1",
              user_id: "free-user-1",
              output_data: {
                imageUrl: "https://cdn.example.com/images/job-1.png",
                videoUrl: "https://cdn.example.com/videos/job-1.mp4",
              },
            },
          ],
          error: null,
        },
        // Repeated to handle .limit() terminal after .in()
        {
          data: [
            {
              id: "job-1",
              user_id: "free-user-1",
              output_data: {
                imageUrl: "https://cdn.example.com/images/job-1.png",
                videoUrl: "https://cdn.example.com/videos/job-1.mp4",
              },
            },
          ],
          error: null,
        },
        { data: [], error: null },
        { data: [], error: null },
      ])

      mockBatchDeleteFromR2.mockResolvedValue({ deleted: 2, errors: 0 })

      const result = await cleanupFreeUserMedia()
      // At least some files were deleted via batch
      expect(result.filesDeleted).toBeGreaterThan(0)
    })

    it("handles assets query error gracefully", async () => {
      mockTableQueue("profiles", [
        { data: [{ id: "free-user-1" }], error: null },
      ])
      mockTableQueue("assets", [
        { data: null, error: { message: "assets query error" } },
      ])
      mockTableQueue("jobs", [
        { data: [], error: null },
      ])

      const result = await cleanupFreeUserMedia()
      expect(result.errors).toBe(1)
    })

    it("handles jobs query error gracefully", async () => {
      mockTableQueue("profiles", [
        { data: [{ id: "free-user-1" }], error: null },
      ])
      mockTableQueue("assets", [
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [
        { data: null, error: { message: "jobs query error" } },
      ])

      const result = await cleanupFreeUserMedia()
      expect(result.errors).toBe(1)
    })

    it("scans the locations table for R2 keys for free-tier users", async () => {
      // Same locations contract as the canceled-user test, scoped to free users.
      mockTableQueue("profiles", [
        { data: [{ id: "free-user-1" }], error: null },
      ])
      mockTableQueue("assets", [
        { data: [], error: null },
      ])
      mockTableQueue("jobs", [
        { data: [], error: null },
      ])
      mockTableQueue("locations", [
        {
          data: [
            {
              source_image_url: "https://cdn.example.com/locations/main.png",
              time_of_day: null,
              weather: null,
              seasons: null,
              angles: null,
              lighting: [
                { name: "morning", url: "https://cdn.example.com/locations/lighting-1.png" },
                { name: "noon",    url: "https://cdn.example.com/locations/lighting-2.png" },
                { name: "dusk",    url: "https://cdn.example.com/locations/lighting-3.png" },
              ],
              atmosphere_motions: null,
              reference_photos: [
                { kind: "mood",      url: "https://cdn.example.com/locations/ref-1.jpg" },
                { kind: "reference", url: "https://cdn.example.com/locations/ref-2.jpg" },
              ],
            },
          ],
          error: null,
        },
      ])

      const allKeysSeen: string[] = []
      mockBatchDeleteFromR2.mockImplementation((keys: readonly string[]) => {
        allKeysSeen.push(...keys)
        return Promise.resolve({ deleted: keys.length, errors: 0 })
      })

      await cleanupFreeUserMedia()

      expect(allKeysSeen).toEqual(
        expect.arrayContaining([
          "locations/main.png",
          "locations/lighting-1.png",
          "locations/lighting-2.png",
          "locations/lighting-3.png",
          "locations/ref-1.jpg",
          "locations/ref-2.jpg",
        ]),
      )
      expect(allKeysSeen.length).toBe(6)
    })

    it("free-user location reaper filters by the 60-day created_at cutoff (protects active media)", async () => {
      mockTableQueue("profiles", [{ data: [{ id: "free-user-1" }], error: null }])
      mockTableQueue("assets", [{ data: [], error: null }])
      mockTableQueue("jobs", [{ data: [], error: null }])
      mockTableQueue("locations", [{ data: [], error: null }])

      await cleanupFreeUserMedia()

      // Regression (CRITICAL): the location sweep MUST apply the created_at cutoff
      // like the assets/jobs phases. Without it, an active free user's brand-new
      // Location Studio media was deleted on the very next nightly run.
      const locationCutoff = ltCalls.find(
        (c) => c.table === "locations" && c.col === "created_at",
      )
      expect(locationCutoff).toBeDefined()
    })
  })
})
