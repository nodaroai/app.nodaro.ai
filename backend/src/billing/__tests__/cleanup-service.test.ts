import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIER_STORAGE_LIMITS } from "../stripe-config.js"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, tableResponses, setLastMatchedResponse, mockBatchDeleteFromR2, mockDeleteFromR2, mockUpdateStorageUsage } = vi.hoisted(() => {
  const tableResponses = new Map<string, Array<{ data: unknown; error: unknown }>>()
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
    chain.lt = vi.fn(self)
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

vi.mock("@/billing/stripe-config.js", async () => {
  const actual = await vi.importActual<typeof import("../stripe-config.js")>("@/billing/stripe-config.js")
  return actual
})

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { expireSubscriptions, cleanupFreeUserMedia, sendStorageWarnings } from "../cleanup-service.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTableQueue(table: string, responses: Array<{ data: unknown; error: unknown }>): void {
  tableResponses.set(table, [...responses])
}

function resetMocks(): void {
  tableResponses.clear()
  setLastMatchedResponse(null)
  mockFrom.mockClear()
  mockRpc.mockClear()
  mockBatchDeleteFromR2.mockClear()
  mockDeleteFromR2.mockClear()
  mockUpdateStorageUsage.mockClear()
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
      // First query: canceled subscriptions past period end
      mockTableQueue("subscriptions", [
        {
          data: [
            { id: "sub-1", user_id: "user-1", stripe_subscription_id: "ps-1" },
            { id: "sub-2", user_id: "user-2", stripe_subscription_id: "ps-2" },
          ],
          error: null,
        },
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
  })
})
