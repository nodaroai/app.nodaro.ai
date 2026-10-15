/**
 * What a retention reaper does with a row whose object it KEEPS (MEDIUM 3 of
 * the 2026-10-15 review).
 *
 * A reaper deletes an aged row's object only when the row's user provably made
 * it and nobody else claims it (`lib/key-ownership.ts`). It used to null EVERY
 * reaped row's key, the kept ones included, and to refund none of the kept
 * ones. So an object nobody could be shown to own lost its only pointer (an
 * orphan nothing would ever delete or show), and a user whose own upload was
 * kept only because another library also holds it lost the item AND kept
 * paying for it.
 *
 * Now, per row:
 *   - deleted object: the row loses its key; its size is refunded when it was
 *     a charge (an origin row);
 *   - kept because another user claims it: the claim keeps the object, so this
 *     row lets go of the key — and is refunded when it was a charge;
 *   - kept because nobody can be shown to own it: the row KEEPS its key (it
 *     may be the object's only record) and refunds nothing.
 * The reads page by id, so rows that keep their keys never stall the loop.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Row = Record<string, unknown>

const h = vi.hoisted(() => {
  const db: Record<string, Row[]> = {}
  const deleted: string[] = []
  const updates: Array<{ table: string; patch: Row; ids: unknown[] }> = []
  let reads = 0

  function makeChain(table: string) {
    const tests: Array<(r: Row) => boolean> = []
    let patch: Row | null = null
    let order = false
    let limit: number | undefined
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.select = vi.fn(self)
    chain.eq = vi.fn((c: string, v: unknown) => (tests.push((r) => r[c] === v), chain))
    chain.neq = vi.fn((c: string, v: unknown) => (tests.push((r) => r[c] !== v), chain))
    chain.in = vi.fn((c: string, vs: unknown[]) => (tests.push((r) => vs.includes(r[c])), chain))
    chain.is = vi.fn((c: string, v: unknown) => (tests.push((r) => (r[c] ?? null) === v), chain))
    chain.not = vi.fn((c: string, op: string, v: unknown) => {
      if (op === "is") tests.push((r) => (r[c] ?? null) !== v)
      return chain
    })
    chain.lt = vi.fn((c: string, v: unknown) => (tests.push((r) => String(r[c]) < String(v)), chain))
    chain.gt = vi.fn((c: string, v: unknown) => (tests.push((r) => String(r[c]) > String(v)), chain))
    chain.or = vi.fn(self)
    chain.order = vi.fn(() => ((order = true), chain))
    chain.limit = vi.fn((n: number) => ((limit = n), chain))
    chain.update = vi.fn((p: Row) => ((patch = p), chain))
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const rows = db[table] ?? []
      if (patch) {
        const ids = rows.filter((r) => tests.every((t) => t(r)))
        updates.push({ table, patch, ids: ids.map((r) => r.id) })
        db[table] = rows.map((r) => (ids.includes(r) ? { ...r, ...patch } : r))
        return Promise.resolve({ data: null, error: null }).then(resolve, reject)
      }
      reads++
      if (reads > 500) return Promise.reject(new Error("the reaper is spinning")).then(resolve, reject)
      let out = rows.filter((r) => tests.every((t) => t(r)))
      if (order) out = [...out].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
      if (limit !== undefined) out = out.slice(0, limit)
      return Promise.resolve({ data: out, error: null }).then(resolve, reject)
    }
    return chain
  }

  return {
    db,
    deleted,
    updates,
    resetReads: () => {
      reads = 0
    },
    from: vi.fn((table: string) => makeChain(table)),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    updateStorageUsage: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: h.from, rpc: h.rpc, auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", R2_PUBLIC_URL: "https://cdn.example.com" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/relay-possible.js", () => ({ relayPossible: () => false }))
vi.mock("@/lib/storage.js", () => ({
  deleteFromR2: vi.fn(),
  batchDeleteFromR2: vi.fn(),
  listObjectsByPrefixWithMeta: vi.fn(),
}))
vi.mock("@/lib/storage-delete.js", () => ({
  deleteKeysRecordingFailures: vi.fn(async (keys: readonly string[]) => {
    h.deleted.push(...keys)
    return { deleted: keys.length, errors: 0, failed: [] }
  }),
  publicUrlOfKey: (k: string) => `https://cdn.example.com/${k}`,
}))
vi.mock("@/lib/asset-delete.js", () => ({
  relayOwnedKeys: vi.fn(async () => new Set()),
  deletableKeys: vi.fn(async (keys: string[]) => [...keys]),
}))
vi.mock("@/utils/file-validation.js", () => ({ updateStorageUsage: h.updateStorageUsage }))
vi.mock("@/ee/billing/downgrade-floor.js", () => ({
  downgradeToEffectiveFloor: vi.fn().mockResolvedValue({ error: null }),
  fetchLifetimeTopups: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: vi.fn() } }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))

import { cleanupFreeUserMedia, cleanupCanceledUserMedia } from "../cleanup-service.js"
import { _resetRecordedReferenceColumnForTests } from "../../../lib/key-ownership.js"

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const MY_JOB = "11111111-1111-4111-8111-111111111111"
const OLD = "2020-01-01T00:00:00Z"
const RECENT = "2999-01-01T00:00:00Z"
const OWN_UPLOAD = "uploads/images/44444444-4444-4444-8444-444444444444.png"
const SHARED_UPLOAD = "uploads/images/55555555-5555-4555-8555-555555555555.png"
const OPERATOR_FILE = "brand/makers/acme.svg"
const MY_OUTPUT = `images/${MY_JOB}.png`

const asset = (over: Row): Row => ({
  user_id: ME,
  r2_url: "u",
  created_at: OLD,
  job_id: null,
  upload_source: "manual_upload",
  size_bytes: 0,
  pipeline_id: null,
  pipeline_entity_id: null,
  relay_job_id: null,
  recorded_reference: false,
  ...over,
})

function seed(profiles: Row[]): void {
  for (const k of Object.keys(h.db)) delete h.db[k]
  h.db.profiles = profiles
  h.db.subscriptions = []
  h.db.jobs = [{ id: MY_JOB, user_id: ME, status: "completed", output_data: null, created_at: OLD }]
  h.db.locations = []
  h.db.assets = [
    asset({ id: "a-own-upload", r2_key: OWN_UPLOAD, size_bytes: 1000 }),
    asset({ id: "b-shared-upload", r2_key: SHARED_UPLOAD, size_bytes: 2000 }),
    asset({ id: "c-save-operator", r2_key: OPERATOR_FILE, upload_source: "generated", recorded_reference: true }),
    asset({ id: "d-my-output", r2_key: MY_OUTPUT, upload_source: "generated", job_id: MY_JOB, size_bytes: 3000 }),
    // Another user's (recent, unreaped) library save of my upload: a claim.
    asset({ id: "z-other-save", user_id: OTHER, r2_key: SHARED_UPLOAD, created_at: RECENT, upload_source: "generated", recorded_reference: true }),
  ]
}

const keyOf = (id: string) => h.db.assets!.find((r) => r.id === id)?.r2_key ?? null
const sizeOf = (id: string) => h.db.assets!.find((r) => r.id === id)?.size_bytes

beforeEach(() => {
  vi.clearAllMocks()
  h.deleted.length = 0
  h.updates.length = 0
  h.resetReads()
  _resetRecordedReferenceColumnForTests()
})

describe("cleanupFreeUserMedia — rows whose objects are kept", () => {
  beforeEach(() => seed([{ id: ME, lifetime_topup_credits: 0, last_topup_at: null }]))

  it("deletes only what the user provably owns alone", async () => {
    await cleanupFreeUserMedia()
    expect([...h.deleted].sort()).toEqual([MY_OUTPUT, OWN_UPLOAD].sort())
  })

  it("a row nobody can be shown to own keeps its key: it may be the object's only record", async () => {
    await cleanupFreeUserMedia()
    expect(keyOf("c-save-operator")).toBe(OPERATOR_FILE)
  })

  it("a row whose object another library holds lets go of the key — the claim keeps the object", async () => {
    await cleanupFreeUserMedia()
    expect(keyOf("b-shared-upload")).toBeNull()
    expect(keyOf("z-other-save")).toBe(SHARED_UPLOAD)
    expect(keyOf("a-own-upload")).toBeNull()
    expect(keyOf("d-my-output")).toBeNull()
  })

  it("refunds every row that was a charge, the kept-for-another-library one included; frees only what went", async () => {
    const result = await cleanupFreeUserMedia()
    expect(h.updateStorageUsage).toHaveBeenCalledWith(ME, -6000)
    expect(result.bytesFreed).toBe(4000)
  })

  it("a second run neither refunds nor deletes again", async () => {
    await cleanupFreeUserMedia()
    h.updateStorageUsage.mockClear()
    h.deleted.length = 0
    await cleanupFreeUserMedia()
    expect(h.deleted).toEqual([])
    expect(h.updateStorageUsage).not.toHaveBeenCalled()
    expect(keyOf("c-save-operator")).toBe(OPERATOR_FILE)
    expect(sizeOf("c-save-operator")).toBe(0)
  })

  it("pages past rows that keep their keys instead of reading them forever", async () => {
    const saves = Array.from({ length: 250 }, (_, i) =>
      asset({ id: `c0-${String(i).padStart(4, "0")}`, r2_key: `brand/file-${i}.svg`, upload_source: "generated", recorded_reference: true }),
    )
    h.db.assets = [...h.db.assets!, ...saves]
    const result = await cleanupFreeUserMedia()
    expect(result.errors).toBe(0)
    expect(saves.every((s) => keyOf(String(s.id)) === s.r2_key)).toBe(true)
    // ...and the row that sorts after them (on the third page) is still reaped.
    expect(keyOf("d-my-output")).toBeNull()
  })
})

describe("cleanupCanceledUserMedia — rows whose objects are kept", () => {
  beforeEach(() =>
    seed([{ id: ME, tier: "creator", subscription_tier: "creator", subscription_ended_at: OLD, lifetime_topup_credits: 0 }]),
  )

  it("deletes only what the user provably owns alone, keeps the unprovable row's key, frees only what went", async () => {
    const result = await cleanupCanceledUserMedia()
    expect([...h.deleted].sort()).toEqual([MY_OUTPUT, OWN_UPLOAD].sort())
    expect(keyOf("c-save-operator")).toBe(OPERATOR_FILE)
    expect(keyOf("b-shared-upload")).toBeNull()
    expect(keyOf("z-other-save")).toBe(SHARED_UPLOAD)
    expect(result.bytesFreed).toBe(4000)
  })

  it("pages past rows that keep their keys", async () => {
    const saves = Array.from({ length: 150 }, (_, i) =>
      asset({ id: `c0-${String(i).padStart(4, "0")}`, r2_key: `brand/file-${i}.svg`, upload_source: "generated", recorded_reference: true }),
    )
    h.db.assets = [...h.db.assets!, ...saves]
    const result = await cleanupCanceledUserMedia()
    expect(result.errors).toBe(0)
    expect(keyOf("d-my-output")).toBeNull()
  })
})
