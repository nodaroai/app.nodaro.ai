/**
 * The owner's changes to a job (`PATCH /v1/jobs/:id`): name and cover, each
 * optional, in one owner-scoped write. Another user's job is never judged,
 * copied or written; a refused picture writes nothing; a replaced or cleared
 * cover's copy is released; a column not in the database yet answers
 * "not available".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  owned: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  updateError: null as null | { code?: string; message: string },
  patches: [] as Array<Record<string, unknown>>,
  /** The filters each write carried (the compare-and-set on the cover). */
  writeFilters: [] as Array<Array<[string, string, unknown]>>,
  /** What a re-read of the row answers after a write that matched nothing (undefined: the same as the first read). */
  reread: undefined as Record<string, unknown> | null | undefined,
  reads: 0,
  resolve: vi.fn(),
  store: vi.fn(),
  release: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const q = {
          eq: () => q,
          is: () => q,
          maybeSingle: async () => ({ data: h.reads++ === 0 || h.reread === undefined ? h.owned : h.reread, error: null }),
        }
        return q
      },
      update: (patch: Record<string, unknown>) => {
        h.patches.push(patch)
        const filters: Array<[string, string, unknown]> = []
        h.writeFilters.push(filters)
        const q = {
          eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
          is: (c: string, v: unknown) => (filters.push(["is", c, v]), q),
          select: () => q,
          maybeSingle: async () => ({ data: h.updated, error: h.updateError }),
        }
        return q
      },
    }),
  },
}))
vi.mock("@/lib/job-cover/cover-source.js", () => ({ resolveJobCoverSource: h.resolve }))
vi.mock("@/lib/job-cover/cover-store.js", () => ({ storeJobCover: h.store, releaseJobCovers: h.release }))

import { updateJobOwnerFields } from "../job-update.js"
import { setTitleColumnPresentForTests } from "../jobs-title-column.js"
import { setCoverColumnPresentForTests } from "../jobs-cover-column.js"
import { JOB_COVER_WRITE_LIMIT, resetCoverWriteLimitForTests } from "../job-cover/cover-rate-limit.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000c1"
const COPY = `https://cdn.test/job-covers/${OWNER}/cover-1.png`
const OLD = `https://cdn.test/job-covers/${OWNER}/cover-0.png`
const SUNO_ART = "https://musicfile.example/art.jpeg"

beforeEach(() => {
  vi.clearAllMocks()
  h.patches = []
  h.writeFilters = []
  h.reread = undefined
  h.reads = 0
  h.owned = { id: JOB, output_data: { sunoImageUrl: SUNO_ART }, cover_url: OLD }
  h.updated = null
  h.updateError = null
  h.resolve.mockResolvedValue({ ok: true, sourceKey: "uploads/images/a.png", ext: "png" })
  h.store.mockResolvedValue(COPY)
  setTitleColumnPresentForTests(true)
  setCoverColumnPresentForTests(true)
  resetCoverWriteLimitForTests()
})

describe("updateJobOwnerFields", () => {
  it("a cover: judged, copied, written; the replaced copy is released; the answer is the picture now", async () => {
    h.updated = { id: JOB, output_data: {}, cover_url: COPY }
    const out = await updateJobOwnerFields(OWNER, JOB, { cover: { assetId: "a1" } })
    expect(out).toEqual({ kind: "ok", coverUrl: COPY })
    expect(h.store).toHaveBeenCalledWith(OWNER, "uploads/images/a.png", "png")
    expect(h.patches).toEqual([{ cover_url: COPY }])
    expect(h.release).toHaveBeenCalledWith(OWNER, [OLD])
  })

  it("a name and a cover in one write", async () => {
    h.updated = { id: JOB, output_data: {}, title: "Mine", cover_url: COPY }
    expect(await updateJobOwnerFields(OWNER, JOB, { title: "Mine", cover: { url: "https://cdn.test/a.png" } })).toEqual({ kind: "ok", title: "Mine", coverUrl: COPY })
    expect(h.patches).toEqual([{ title: "Mine", cover_url: COPY }])
  })

  it("clearing the cover brings the provider's art back, and releases the copy", async () => {
    h.updated = { id: JOB, output_data: { sunoImageUrl: SUNO_ART }, cover_url: null }
    expect(await updateJobOwnerFields(OWNER, JOB, { cover: null })).toEqual({ kind: "ok", coverUrl: SUNO_ART })
    expect(h.patches).toEqual([{ cover_url: null }])
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledWith(OWNER, [OLD])
  })

  it("another user's job (or none): not found, and nothing is judged, copied or written", async () => {
    h.owned = null
    expect(await updateJobOwnerFields(OWNER, JOB, { cover: { assetId: "a1" } })).toEqual({ kind: "not_found" })
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.store).not.toHaveBeenCalled()
    expect(h.patches).toEqual([])
  })

  it("a refused picture writes nothing", async () => {
    h.resolve.mockResolvedValue({ ok: false, problem: "wrong_format" })
    expect(await updateJobOwnerFields(OWNER, JOB, { cover: { url: "https://cdn.test/a.svg" } })).toEqual({ kind: "invalid_cover", problem: "wrong_format" })
    expect(h.store).not.toHaveBeenCalled()
    expect(h.patches).toEqual([])
  })

  it("a write that fails releases the copy it made", async () => {
    h.updateError = { message: "boom" }
    await expect(updateJobOwnerFields(OWNER, JOB, { cover: { assetId: "a1" } })).rejects.toMatchObject({ message: "boom" })
    expect(h.release).toHaveBeenCalledWith(OWNER, [COPY])
  })

  it("a column not in the database yet: not available, nothing asked", async () => {
    setCoverColumnPresentForTests(false)
    expect(await updateJobOwnerFields(OWNER, JOB, { cover: null })).toEqual({ kind: "not_available", field: "cover" })
    setCoverColumnPresentForTests(true)
    setTitleColumnPresentForTests(false)
    expect(await updateJobOwnerFields(OWNER, JOB, { title: "x" })).toEqual({ kind: "not_available", field: "title" })
    expect(h.patches).toEqual([])
  })

  it("a cover write is a compare-and-set on the cover it read: none read, or the one read", async () => {
    h.updated = { id: JOB, output_data: {}, cover_url: COPY }
    await updateJobOwnerFields(OWNER, JOB, { cover: { assetId: "a1" } })
    expect(h.writeFilters[0]).toContainEqual(["eq", "cover_url", OLD])
    h.owned = { id: JOB, output_data: {}, cover_url: null }
    await updateJobOwnerFields(OWNER, JOB, { cover: { assetId: "a1" } })
    expect(h.writeFilters[1]).toContainEqual(["is", "cover_url", null])
    // A name alone never guards on the cover.
    h.updated = { id: JOB, output_data: {}, title: "x" }
    await updateJobOwnerFields(OWNER, JOB, { title: "x" })
    expect(h.writeFilters[2]!.some(([, c]) => c === "cover_url")).toBe(false)
  })

  it("a change that lost the race to another cover change: conflict, its own copy released, the winner's untouched", async () => {
    h.updated = null
    const out = await updateJobOwnerFields(OWNER, JOB, { cover: { assetId: "a1" } })
    expect(out).toEqual({ kind: "conflict" })
    expect(h.release).toHaveBeenCalledTimes(1)
    expect(h.release).toHaveBeenCalledWith(OWNER, [COPY])
  })

  it("a job deleted between the read and the write is not found, not a conflict", async () => {
    h.updated = null
    h.reread = null
    expect(await updateJobOwnerFields(OWNER, JOB, { cover: null })).toEqual({ kind: "not_found" })
  })

  it("a missing column is matched to ITS field by the error's message", async () => {
    h.updateError = { code: "42703", message: "column jobs.title does not exist" }
    expect(await updateJobOwnerFields(OWNER, JOB, { title: "x", cover: null })).toEqual({ kind: "not_available", field: "title" })
    setTitleColumnPresentForTests(true)
    setCoverColumnPresentForTests(true)
    h.updateError = { code: "PGRST204", message: "Could not find the 'cover_url' column of 'jobs' in the schema cache" }
    expect(await updateJobOwnerFields(OWNER, JOB, { title: "x", cover: null })).toEqual({ kind: "not_available", field: "cover" })
    setCoverColumnPresentForTests(true)
    // Another column's absence is not this one's: a real error, thrown.
    h.updateError = { code: "42703", message: "column jobs.something_else does not exist" }
    await expect(updateJobOwnerFields(OWNER, JOB, { cover: null })).rejects.toMatchObject({ code: "42703" })
  })

  it("cover changes have a limit of their own per user, asked before anything is read; a name alone never counts", async () => {
    h.updated = { id: JOB, output_data: {}, cover_url: null }
    for (let i = 0; i < JOB_COVER_WRITE_LIMIT.max; i++) {
      expect((await updateJobOwnerFields(OWNER, JOB, { cover: null })).kind).toBe("ok")
    }
    const reads = h.reads
    const over = await updateJobOwnerFields(OWNER, JOB, { cover: null })
    expect(over).toMatchObject({ kind: "rate_limited" })
    expect((over as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0)
    expect(h.reads).toBe(reads)
    h.updated = { id: JOB, output_data: {}, title: "x" }
    expect((await updateJobOwnerFields(OWNER, JOB, { title: "x" })).kind).toBe("ok")
    h.updated = { id: JOB, output_data: {}, cover_url: null }
    expect((await updateJobOwnerFields("00000000-0000-4000-8000-000000000009", JOB, { cover: null })).kind).toBe("ok")
  })
})
