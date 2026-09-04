/**
 * THE RELAY DELETE RULE inside the billing reapers (spec
 * 2026-09-04-sai-local-development §9.3, D18, invariants 9 and 10a).
 *
 * These crons were the last unguarded delete paths, and "the cron cannot see a
 * relayed row" was a convention rather than a guarantee: relaying is gated on
 * `isNodaroConnected()` with no edition test, `R2_SHARED_WITH_RELAY_TARGET` is
 * an independent env var, and `startCleanupCron()` runs behind `hasCredits()` —
 * so `EDITION=cloud` + a connection + a shared bucket is a configurable state
 * in which a free-tier user's relayed asset had the FAR END's object
 * batch-deleted and `storage_used_bytes` walked DOWN by bytes the passthrough
 * never charged.
 *
 * The predicate itself is tested in lib/__tests__/asset-delete.test.ts; this
 * file pins that the reapers CONSULT it, and that a kept object moves neither
 * bytes nor quota while its row cleanup still runs (the `r2_key` null-out in
 * particular — without it the `WHERE r2_key IS NOT NULL` loops spin forever).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockFrom,
  mockRpc,
  tableResponses,
  mockBatchDeleteFromR2,
  mockUpdateStorageUsage,
  mockRelayOwnedKeys,
  mockDeletableKeys,
} = vi.hoisted(() => {
  const tableResponses = new Map<string, Array<{ data: unknown; error: unknown }>>()

  function shiftResponse(table: string): { data: unknown; error: unknown } {
    const queue = tableResponses.get(table)
    if (!queue || queue.length === 0) return { data: null, error: null }
    if (queue.length === 1) return queue[0]
    return queue.shift()!
  }

  function createChain(table: string) {
    const chain: Record<string, unknown> = {}
    let isReadChain = false
    const self = () => chain
    chain.select = vi.fn(() => {
      isReadChain = true
      return chain
    })
    chain.eq = vi.fn(self)
    chain.neq = vi.fn(self)
    chain.or = vi.fn(self)
    chain.not = vi.fn(self)
    chain.is = vi.fn(self)
    chain.lt = vi.fn(self)
    chain.gt = vi.fn(self)
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
    chain.update = vi.fn(() => {
      isReadChain = false
      return chain
    })
    chain.upsert = vi.fn(self)
    chain.single = vi.fn(() => Promise.resolve(shiftResponse(table)))
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    return chain
  }

  return {
    tableResponses,
    mockFrom: vi.fn().mockImplementation((table: string) => createChain(table)),
    mockRpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    mockBatchDeleteFromR2: vi.fn().mockResolvedValue({ deleted: 0, errors: 0 }),
    mockUpdateStorageUsage: vi.fn().mockResolvedValue(undefined),
    mockRelayOwnedKeys: vi.fn(),
    mockDeletableKeys: vi.fn(),
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: mockRpc },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://cdn.example.com" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/storage.js", () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  batchDeleteFromR2: mockBatchDeleteFromR2,
  listObjectsByPrefixWithMeta: vi.fn(),
}))

vi.mock("@/utils/file-validation.js", () => ({ updateStorageUsage: mockUpdateStorageUsage }))

/** The shared predicate (lib/asset-delete.ts) — the thing every reaper must
 *  consult. Its own semantics are tested where it lives. */
vi.mock("@/lib/asset-delete.js", () => ({
  relayOwnedKeys: mockRelayOwnedKeys,
  deletableKeys: mockDeletableKeys,
}))

vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: vi.fn() } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

import {
  cleanupFreeUserMedia,
  cleanupCanceledUserMedia,
  sweepSoftDeletedLocationAssets,
} from "../cleanup-service.js"

const FAR_KEY = "images/ffffffff-ffff-4000-8000-000000000001.png"
const OURS_KEY = "videos/11111111-1111-4000-8000-000000000001.mp4"

function queue(table: string, responses: Array<{ data: unknown; error: unknown }>): void {
  tableResponses.set(table, [...responses])
}

beforeEach(() => {
  tableResponses.clear()
  vi.clearAllMocks()
  mockBatchDeleteFromR2.mockResolvedValue({ deleted: 0, errors: 0 })
  mockUpdateStorageUsage.mockResolvedValue(undefined)
  // Default: nothing is relay-owned — the mainline answer.
  mockRelayOwnedKeys.mockResolvedValue(new Set())
  mockDeletableKeys.mockImplementation(async (keys: string[]) => [...keys])
})

describe("cleanupFreeUserMedia — the relay fence", () => {
  it("never deletes a relay-owned object and never decrements its bytes", async () => {
    queue("profiles", [{ data: [{ id: "free-user-1" }], error: null }])
    queue("assets", [
      {
        data: [
          { id: "a-far", user_id: "free-user-1", r2_key: FAR_KEY, size_bytes: 4096 },
          { id: "a-ours", user_id: "free-user-1", r2_key: OURS_KEY, size_bytes: 1024 },
        ],
        error: null,
      },
    ])
    queue("jobs", [{ data: [], error: null }])
    mockRelayOwnedKeys.mockResolvedValue(new Set([FAR_KEY]))
    mockBatchDeleteFromR2.mockResolvedValue({ deleted: 1, errors: 0 })

    const result = await cleanupFreeUserMedia()

    // The far end's bytes are not in the batch...
    expect(mockBatchDeleteFromR2).toHaveBeenCalledWith([OURS_KEY])
    // ...and its size is neither reported freed nor refunded (invariant 10a:
    // the passthrough never charged it, so a decrement walks the counter down
    // toward migration 022's GREATEST(0,…) floor).
    expect(result.bytesFreed).toBe(1024)
    expect(mockUpdateStorageUsage).toHaveBeenCalledWith("free-user-1", -1024)
  })

  it("routes harvested job-output keys through the predicate", async () => {
    queue("profiles", [{ data: [{ id: "free-user-1" }], error: null }])
    queue("assets", [{ data: [], error: null }])
    queue("jobs", [
      {
        data: [
          {
            id: "job-1",
            user_id: "free-user-1",
            output_data: { imageUrl: `https://cdn.example.com/${FAR_KEY}` },
          },
        ],
        error: null,
      },
    ])
    mockDeletableKeys.mockResolvedValue([])

    await cleanupFreeUserMedia()

    expect(mockDeletableKeys).toHaveBeenCalledWith([FAR_KEY])
    // Nothing deletable ⇒ no batch call at all.
    expect(mockBatchDeleteFromR2).not.toHaveBeenCalled()
  })
})

describe("cleanupCanceledUserMedia — the relay fence", () => {
  it("keeps a relay-owned object and does not count its bytes as freed", async () => {
    queue("profiles", [
      {
        data: [
          {
            id: "cancelled-1",
            subscription_tier: "creator",
            subscription_status: "canceled",
            subscription_ends_at: new Date(Date.now() - 90 * 86400_000).toISOString(),
          },
        ],
        error: null,
      },
    ])
    queue("assets", [
      {
        data: [
          { id: "a-far", r2_key: FAR_KEY, size_bytes: 4096 },
          { id: "a-ours", r2_key: OURS_KEY, size_bytes: 1024 },
        ],
        error: null,
      },
    ])
    queue("jobs", [{ data: [], error: null }])
    mockRelayOwnedKeys.mockResolvedValue(new Set([FAR_KEY]))

    const result = await cleanupCanceledUserMedia()

    expect(mockBatchDeleteFromR2).toHaveBeenCalledWith([OURS_KEY])
    expect(result.bytesFreed).toBe(1024)
  })
})

describe("sweepSoftDeletedLocationAssets — the relay fence", () => {
  it("consults the predicate, exactly as its interactive twin does", async () => {
    queue("locations", [
      {
        data: [
          {
            id: "loc-1",
            source_image_url: `https://cdn.example.com/${FAR_KEY}`,
            angles: [{ url: `https://cdn.example.com/${OURS_KEY}` }],
          },
        ],
        error: null,
      },
    ])
    mockDeletableKeys.mockResolvedValue([OURS_KEY])

    const result = await sweepSoftDeletedLocationAssets()

    expect(mockDeletableKeys).toHaveBeenCalledWith([FAR_KEY, OURS_KEY])
    expect(mockBatchDeleteFromR2).toHaveBeenCalledWith([OURS_KEY])
    // Only what was actually deleted is counted.
    expect(result.r2KeysDeleted).toBe(1)
  })
})
