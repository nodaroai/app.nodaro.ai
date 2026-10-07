/**
 * Whose file a reaper deletes (decided 2026-10-06; migration 480).
 *
 * The reapers find keys in rows: a user's `assets` rows and the url columns of
 * their locations. Before 480 a browser could write either with ANY key, and
 * an API path can still store a url the caller names. So a row naming another
 * user's file put that file on the owner's reaping list. Every reaper now asks
 * `lib/key-ownership.ts` first: a key that another user's job made (its key
 * family) or that sits in another user's upload namespace is never deleted on
 * this user's behalf. The row cleanup still runs, so the loops terminate, and
 * no storage is refunded for bytes this user was never charged.
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


const ATTACKER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const VICTIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const VICTIM_JOB = "22222222-2222-4222-8222-222222222222"
const VICTIM_KEY = `videos/${VICTIM_JOB}.mp4`
const VICTIM_UPLOAD = `uploads/image/${VICTIM}/33333333-3333-4333-8333-333333333333.png`
const OWN_JOB = "11111111-1111-4111-8111-111111111111"
const OWN_KEY = `images/${OWN_JOB}.png`
/** A plain `POST /v1/upload` key: no job family, no namespace. Only the
 *  victim's own `assets` row says whose it is. */
const VICTIM_PLAIN_UPLOAD = "uploads/images/44444444-4444-4444-8444-444444444444.png"
/** What `assets.select("r2_key, user_id").in("r2_key", …)` answers. */
const victimHolds = { data: [{ r2_key: VICTIM_PLAIN_UPLOAD, user_id: VICTIM }], error: null }

function queue(table: string, responses: Array<{ data: unknown; error: unknown }>): void {
  tableResponses.set(table, [...responses])
}

/** What `jobs.select("id, user_id").in("id", …)` answers: who made which key. */
const makers = { data: [{ id: VICTIM_JOB, user_id: VICTIM }, { id: OWN_JOB, user_id: ATTACKER }], error: null }

beforeEach(() => {
  tableResponses.clear()
  vi.clearAllMocks()
  mockBatchDeleteFromR2.mockResolvedValue({ deleted: 0, errors: 0 })
  mockUpdateStorageUsage.mockResolvedValue(undefined)
  mockRelayOwnedKeys.mockResolvedValue(new Set())
  mockDeletableKeys.mockImplementation(async (keys: string[]) => [...keys])
})

const deletedKeys = () => mockBatchDeleteFromR2.mock.calls.flatMap((c) => c[0] as string[])

describe("cleanupFreeUserMedia — whose file", () => {
  it("attacker: an assets row naming another user's file never gets that file deleted", async () => {
    queue("profiles", [{ data: [{ id: ATTACKER }], error: null }])
    queue("assets", [
      {
        data: [
          { id: "planted", user_id: ATTACKER, r2_key: VICTIM_KEY, size_bytes: 5_000_000_000 },
          { id: "planted-ns", user_id: ATTACKER, r2_key: VICTIM_UPLOAD, size_bytes: 10 },
          { id: "own", user_id: ATTACKER, r2_key: OWN_KEY, size_bytes: 1024 },
        ],
        error: null,
      },
    ])
    queue("jobs", [makers, { data: [], error: null }])
    mockBatchDeleteFromR2.mockResolvedValue({ deleted: 1, errors: 0 })

    const result = await cleanupFreeUserMedia()

    expect(deletedKeys()).toContain(OWN_KEY)
    expect(deletedKeys()).not.toContain(VICTIM_KEY)
    expect(deletedKeys()).not.toContain(VICTIM_UPLOAD)
    // The planted row's size was never charged to this user: no refund.
    expect(result.bytesFreed).toBe(1024)
    expect(mockUpdateStorageUsage).toHaveBeenCalledWith(ATTACKER, -1024)
  })

  it("attacker: a location naming another user's file never gets that file deleted", async () => {
    queue("profiles", [{ data: [{ id: ATTACKER }], error: null }])
    queue("assets", [{ data: [], error: null }])
    queue("jobs", [{ data: [], error: null }, makers])
    queue("locations", [
      {
        data: [
          {
            source_image_url: `https://cdn.example.com/${VICTIM_KEY}`,
            angles: [{ url: `https://cdn.example.com/${OWN_KEY}` }],
          },
        ],
        error: null,
      },
    ])

    await cleanupFreeUserMedia()

    expect(deletedKeys()).toContain(OWN_KEY)
    expect(deletedKeys()).not.toContain(VICTIM_KEY)
  })

  it("does not delete anything when it cannot tell whose a file is", async () => {
    queue("profiles", [{ data: [{ id: ATTACKER }], error: null }])
    queue("assets", [
      { data: [{ id: "own", user_id: ATTACKER, r2_key: OWN_KEY, size_bytes: 1024 }], error: null },
    ])
    queue("jobs", [{ data: null, error: { message: "timeout" } }])

    const result = await cleanupFreeUserMedia()

    expect(deletedKeys()).toEqual([])
    expect(result.errors).toBeGreaterThan(0)
  })
})

describe("cleanupCanceledUserMedia — whose file", () => {
  const canceled = {
    data: [
      {
        id: ATTACKER,
        subscription_tier: "creator",
        subscription_status: "canceled",
        subscription_ends_at: new Date(Date.now() - 90 * 86400_000).toISOString(),
      },
    ],
    error: null,
  }

  it("attacker: an assets row naming another user's file never gets that file deleted", async () => {
    queue("profiles", [canceled])
    queue("assets", [
      {
        data: [
          { id: "planted", r2_key: VICTIM_KEY, size_bytes: 4096 },
          { id: "own", r2_key: OWN_KEY, size_bytes: 1024 },
        ],
        error: null,
      },
    ])
    queue("jobs", [makers, { data: [], error: null }])

    const result = await cleanupCanceledUserMedia()

    expect(deletedKeys()).toContain(OWN_KEY)
    expect(deletedKeys()).not.toContain(VICTIM_KEY)
    expect(result.bytesFreed).toBe(1024)
  })

  it("attacker: a location naming another user's file never gets that file deleted", async () => {
    queue("profiles", [canceled])
    queue("assets", [{ data: [], error: null }])
    queue("jobs", [{ data: [], error: null }, makers])
    queue("locations", [
      { data: [{ reference_photos: [{ url: `https://cdn.example.com/${VICTIM_KEY}` }] }], error: null },
    ])

    await cleanupCanceledUserMedia()

    expect(deletedKeys()).not.toContain(VICTIM_KEY)
  })
})

describe("sweepSoftDeletedLocationAssets — whose file", () => {
  it("attacker: a deleted location naming another user's file never gets that file deleted", async () => {
    queue("locations", [
      {
        data: [
          {
            id: "loc-1",
            user_id: ATTACKER,
            source_image_url: `https://cdn.example.com/${VICTIM_KEY}`,
            angles: [{ url: `https://cdn.example.com/${OWN_KEY}` }],
          },
        ],
        error: null,
      },
    ])
    queue("jobs", [makers])

    const result = await sweepSoftDeletedLocationAssets()

    expect(deletedKeys()).toEqual([OWN_KEY])
    expect(result.r2KeysDeleted).toBe(1)
  })
})

/**
 * Content-addressed claim (review round, decided 2026-10-07): a plain upload
 * key that the victim's `assets` row holds is the victim's, though nothing in
 * the key names them. Every reaper keeps it.
 */
describe("reapers — another user's plain upload, held by their library", () => {
  it("A1: a free user's assets row naming it is reaped, the object stays", async () => {
    queue("profiles", [{ data: [{ id: ATTACKER }], error: null }])
    const page = {
      data: [
        { id: "saved", user_id: ATTACKER, r2_key: VICTIM_PLAIN_UPLOAD, size_bytes: 2048 },
        { id: "own", user_id: ATTACKER, r2_key: OWN_KEY, size_bytes: 1024 },
      ],
      error: null,
    }
    // The page read answers twice in this mock (its `.in("user_id")` and its
    // `.limit()` both resolve); the library lookup comes after it.
    queue("assets", [
      page,
      page,
      {
        data: [
          { r2_key: VICTIM_PLAIN_UPLOAD, user_id: ATTACKER },
          { r2_key: VICTIM_PLAIN_UPLOAD, user_id: VICTIM },
          { r2_key: OWN_KEY, user_id: ATTACKER },
        ],
        error: null,
      },
    ])
    queue("jobs", [makers, { data: [], error: null }])
    mockBatchDeleteFromR2.mockResolvedValue({ deleted: 1, errors: 0 })

    const result = await cleanupFreeUserMedia()

    expect(deletedKeys()).toContain(OWN_KEY)
    expect(deletedKeys()).not.toContain(VICTIM_PLAIN_UPLOAD)
    expect(result.bytesFreed).toBe(1024)
  })

  it("soft-deleted location sweep: a url naming it never gets it deleted", async () => {
    queue("locations", [
      {
        data: [
          {
            id: "loc-1",
            user_id: ATTACKER,
            source_image_url: `https://cdn.example.com/${VICTIM_PLAIN_UPLOAD}`,
            angles: [{ url: `https://cdn.example.com/${OWN_KEY}` }],
          },
        ],
        error: null,
      },
    ])
    queue("jobs", [makers])
    queue("assets", [victimHolds])

    const result = await sweepSoftDeletedLocationAssets()

    expect(deletedKeys()).toEqual([OWN_KEY])
    expect(result.r2KeysDeleted).toBe(1)
  })
})
