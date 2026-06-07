import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIER_STORAGE_LIMITS } from "../stripe-config.js"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, tableResponses, ltCalls, setLastMatchedResponse, mockBatchDeleteFromR2, mockDeleteFromR2, mockUpdateStorageUsage } = vi.hoisted(() => {
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
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockBatchDeleteFromR2 = vi.fn().mockResolvedValue({ deleted: 0, errors: 0 })
  const mockDeleteFromR2 = vi.fn().mockResolvedValue(undefined)
  const mockUpdateStorageUsage = vi.fn().mockResolvedValue(undefined)

  return {
    mockFrom,
    mockRpc,
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

import { expireSubscriptions, cleanupFreeUserMedia, cleanupCanceledUserMedia, renewSubscriptionCredits, sendStorageWarnings } from "../cleanup-service.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTableQueue(table: string, responses: Array<{ data: unknown; error: unknown }>): void {
  tableResponses.set(table, [...responses])
}

function resetMocks(): void {
  tableResponses.clear()
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
      // would silently reset the paying customer to free / 150 credits / 1GB.
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
                videoUrl: "https://cdn.example.com/videos/out.mp4",
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
                imageUrl: "https://cdn.example.com/images/out.png",
                videoUrl: "https://cdn.example.com/videos/out.mp4",
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
                imageUrl: "https://cdn.example.com/images/out.png",
                videoUrl: "https://cdn.example.com/videos/out.mp4",
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
