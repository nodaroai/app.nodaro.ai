/**
 * A job's cover copy (`job-covers/<userId>/…`, decided 2026-11-23, review
 * round) is kept by EVERY storage deleter while a job still shows it,
 * whoever's row names it: the library delete of a saved copy of its address,
 * a reaper's batch, any `ownKeysOnly` delete. The rule lives once, in the
 * key-ownership judgment (lib/key-ownership.ts), asked only for cover keys.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/relay-possible.js", () => ({ relayPossible: () => false }))

import { supabase } from "../../supabase.js"
import { config } from "../../config.js"
import { setCoverColumnPresentForTests } from "../../jobs-cover-column.js"
import {
  _resetRecordedReferenceColumnForTests,
  judgeAssetRowDelete,
  judgeAssetRows,
  keysUserMayDelete,
  ownKeysOnly,
} from "../../key-ownership.js"

type Row = Record<string, unknown>
let reads: Array<{ table: string; select: string }> = []

function useDb(db: { jobs: Row[]; assets: Row[]; failJobs?: boolean; noCoverColumn?: boolean }): void {
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const read = { table, select: "" }
    reads.push(read)
    const tests: Array<(r: Row) => boolean> = []
    const chain: Record<string, unknown> = {
      select: (cols: string) => ((read.select = cols), chain),
      eq: (c: string, v: unknown) => (tests.push((r) => r[c] === v), chain),
      in: (c: string, vs: unknown[]) => (tests.push((r) => vs.includes(r[c])), chain),
      gt: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown) => unknown) => {
        if (db.failJobs && table === "jobs") return Promise.resolve({ data: null, error: { message: "down" } }).then(resolve)
        if (db.noCoverColumn && table === "jobs" && read.select.includes("cover_url")) {
          return Promise.resolve({ data: null, error: { code: "42703", message: "column jobs.cover_url does not exist" } }).then(resolve)
        }
        const rows = ((db as unknown as Record<string, Row[]>)[table] ?? []).filter((r) => tests.every((t) => t(r)))
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
    return chain
  }) as never)
}

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const SELF_JOB = "11111111-1111-4111-8111-111111111111"
const CDN = "https://cdn.test"
const COVER_KEY = `job-covers/${SELF}/cover-${"a".repeat(32)}-${"b".repeat(32)}.png`
const COVER_URL = `${CDN}/${COVER_KEY}`
const UPLOAD_KEY = "uploads/images/44444444-4444-4444-8444-444444444444.png"
// The owner saved the cover's address to their library: a row that only records it.
const SAVED = { id: "lib1", user_id: SELF, r2_key: COVER_KEY, upload_source: "library", size_bytes: 0, recorded_reference: true }

let saved: string | undefined
beforeEach(() => {
  saved = config.R2_PUBLIC_URL
  config.R2_PUBLIC_URL = CDN
  reads = []
  _resetRecordedReferenceColumnForTests()
  setCoverColumnPresentForTests(true)
})
afterEach(() => {
  config.R2_PUBLIC_URL = saved as string
  setCoverColumnPresentForTests(false)
})

describe("a job's cover copy is kept while a job shows it", () => {
  it("a library delete of the saved address keeps the object while a job names it, and lets it go once none does", async () => {
    useDb({ jobs: [{ id: SELF_JOB, user_id: SELF, cover_url: COVER_URL }], assets: [SAVED] })
    expect(await judgeAssetRowDelete(SELF, { id: "lib1", r2_key: COVER_KEY })).toMatchObject({ owned: true, deleteObject: false })
    expect(await keysUserMayDelete(SELF, [COVER_KEY])).toEqual(new Set())

    useDb({ jobs: [{ id: SELF_JOB, user_id: SELF, cover_url: null }], assets: [SAVED] })
    expect(await judgeAssetRowDelete(SELF, { id: "lib1", r2_key: COVER_KEY })).toMatchObject({ owned: true, deleteObject: true })
  })

  it("a reaper's batch keeps it too", async () => {
    useDb({ jobs: [{ id: SELF_JOB, user_id: SELF, cover_url: COVER_URL }], assets: [SAVED] })
    const verdicts = await judgeAssetRows([{ id: "lib1", user_id: SELF, r2_key: COVER_KEY }])
    expect(verdicts.get("lib1")).toMatchObject({ deleteObject: false })
  })

  it("a batch with no cover key asks nothing more", async () => {
    useDb({ jobs: [], assets: [] })
    await keysUserMayDelete(SELF, [UPLOAD_KEY])
    expect(reads.some((r) => r.select.includes("cover_url"))).toBe(false)
  })

  it("a process that has not seen the column yet asks the database before answering 'no job names it'", async () => {
    setCoverColumnPresentForTests(false)
    useDb({ jobs: [{ id: SELF_JOB, user_id: SELF, cover_url: COVER_URL }], assets: [SAVED] })
    expect(await keysUserMayDelete(SELF, [COVER_KEY])).toEqual(new Set())
    // A database without the column: the probe says so, and no job can name a cover.
    setCoverColumnPresentForTests(false)
    useDb({ jobs: [], assets: [SAVED], noCoverColumn: true })
    expect(await keysUserMayDelete(SELF, [COVER_KEY])).toEqual(new Set([COVER_KEY]))
  })

  it("a failed cover lookup throws: a deleter that cannot ask keeps the object", async () => {
    useDb({ jobs: [], assets: [SAVED], failJobs: true })
    await expect(keysUserMayDelete(SELF, [COVER_KEY])).rejects.toThrow()
    expect(await ownKeysOnly(SELF, [COVER_KEY], "test")).toEqual([])
  })
})
