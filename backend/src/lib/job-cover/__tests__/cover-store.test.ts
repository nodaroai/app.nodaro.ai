/**
 * A job's own copy of its cover (lib/job-cover/cover-store.ts): every set is
 * a new copy; a copy is released only once nothing names it — no job (any
 * user's, the Trash included) and no library row (the owner's own saved copy
 * included) — and then its bytes go back to the owner's quota, unless the
 * storage delete failed (recorded for the retry, nothing refunded). The
 * ownership judgment is the real one, over an in-memory database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  tables: { jobs: [] as Row[], assets: [] as Row[] } as Record<string, Row[]>,
  failRead: null as string | null,
  copies: [] as Array<{ source: string; dest: string; user: string }>,
  deleted: [] as string[],
  failDelete: new Set<string>(),
  usage: [] as Array<{ user: string; delta: number }>,
}))

vi.mock("@/lib/supabase.js", () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      gt: () => q,
      order: () => q,
      limit: () => q,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          h.failRead === table
            ? { data: null, error: { message: `${table} down` } }
            : { data: (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null },
        ).then(resolve),
    }
    return q
  }
  return { supabase: { from } }
})
vi.mock("@/lib/storage.js", () => ({
  copyOwnObjectToKey: async (source: string, dest: string, user: string) => (h.copies.push({ source, dest, user }), `https://cdn.test/${dest}`),
  getR2ObjectSize: async () => 500,
  r2KeyFromOurUrl: (u: string) => (u.startsWith("https://cdn.test/") ? u.slice("https://cdn.test/".length) : null),
}))
vi.mock("@/lib/storage-delete.js", () => ({
  deleteKeysRecordingFailures: async (keys: string[]) => {
    h.deleted.push(...keys)
    return { failed: keys.filter((k) => h.failDelete.has(k)) }
  },
}))
vi.mock("@/utils/file-validation.js", () => ({ updateStorageUsage: async (user: string, delta: number) => void h.usage.push({ user, delta }) }))

import { config } from "../../config.js"
import { _resetRecordedReferenceColumnForTests } from "../../key-ownership.js"
import { setCoverColumnPresentForTests } from "../../jobs-cover-column.js"
import { releaseCoversOfJobs, releaseJobCovers, storeJobCover } from "../cover-store.js"
import { sourceStampOf } from "../cover-key.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const CDN = "https://cdn.test"
const KEY = `job-covers/${USER}/cover-${"a".repeat(32)}-${"b".repeat(32)}.png`
const URL = `${CDN}/${KEY}`

let saved: string | undefined
beforeEach(() => {
  saved = config.R2_PUBLIC_URL
  config.R2_PUBLIC_URL = CDN
  _resetRecordedReferenceColumnForTests()
  setCoverColumnPresentForTests(true)
  h.tables = { jobs: [], assets: [] }
  h.failRead = null
  h.copies = []
  h.deleted = []
  h.failDelete = new Set()
  h.usage = []
})
afterEach(() => {
  config.R2_PUBLIC_URL = saved as string
  setCoverColumnPresentForTests(false)
})

describe("storeJobCover", () => {
  it("every set is a new copy in the owner's covers, stamped with its source — never a reused one", async () => {
    const a = await storeJobCover(USER, "uploads/images/x.png", "png")
    const b = await storeJobCover(USER, "uploads/images/x.png", "png")
    expect(a).not.toBe(b)
    expect(h.copies).toHaveLength(2)
    for (const c of h.copies) {
      expect(c.user).toBe(USER)
      expect(c.dest).toMatch(new RegExp(`^job-covers/${USER}/cover-${sourceStampOf("uploads/images/x.png")}-[0-9a-f]{32}\\.png$`))
    }
  })

  it("a copy of one of the owner's covers is a new copy too", async () => {
    await storeJobCover(USER, KEY, "png")
    expect(h.copies[0]!.source).toBe(KEY)
    expect(h.copies[0]!.dest).not.toBe(KEY)
  })
})

describe("releaseJobCovers", () => {
  it("a copy nothing names is deleted and its bytes refunded", async () => {
    await releaseJobCovers(USER, [URL])
    expect(h.deleted).toEqual([KEY])
    expect(h.usage).toEqual([{ user: USER, delta: -500 }])
  })

  it("a copy a job still names (any user's job, the Trash included) is kept", async () => {
    h.tables.jobs = [{ id: "j2", user_id: USER, cover_url: URL, deleted_at: "2026-11-01T00:00:00Z" }]
    await releaseJobCovers(USER, [URL])
    expect(h.deleted).toEqual([])
    expect(h.usage).toEqual([])
  })

  it("a copy the owner's OWN library row still names is kept (a saved copy of the address)", async () => {
    h.tables.assets = [{ id: "a1", user_id: USER, r2_key: KEY, r2_url: URL, upload_source: "library", size_bytes: 0, recorded_reference: true }]
    await releaseJobCovers(USER, [URL])
    expect(h.deleted).toEqual([])
  })

  it("another user's cover, an address that is not a cover, and nothing at all are never touched", async () => {
    await releaseJobCovers(USER, [`${CDN}/job-covers/${OTHER}/cover-x.png`, `${CDN}/images/a.png`, null, undefined])
    expect(h.deleted).toEqual([])
  })

  it("a failed storage delete is recorded (by the funnel) and refunds nothing", async () => {
    h.failDelete.add(KEY)
    await releaseJobCovers(USER, [URL])
    expect(h.deleted).toEqual([KEY])
    expect(h.usage).toEqual([])
  })

  it("a reference lookup that fails keeps the copy, and never throws", async () => {
    h.failRead = "jobs"
    await expect(releaseJobCovers(USER, [URL])).resolves.toBeUndefined()
    expect(h.deleted).toEqual([])
  })
})

describe("releaseCoversOfJobs", () => {
  it("releases each owner's covers as that owner's", async () => {
    const other = `${CDN}/job-covers/${OTHER}/cover-${"c".repeat(32)}-${"d".repeat(32)}.png`
    await releaseCoversOfJobs([{ userId: USER, coverUrl: URL }, { userId: OTHER, coverUrl: other }, { userId: null, coverUrl: URL }])
    expect(h.deleted.sort()).toEqual([KEY, other.slice(CDN.length + 1)].sort())
    expect(h.usage).toEqual(expect.arrayContaining([{ user: USER, delta: -500 }, { user: OTHER, delta: -500 }]))
  })
})
