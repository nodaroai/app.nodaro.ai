/**
 * The retention of Nodaro Motion's coloured depth maps
 * (`cast-swap/depth-clips/<jobId>-<attempt>-<nonce>.mp4`, cast-swap 0.426.0):
 * a finished run's (or Full Quality version's) map goes once both it and its
 * job are past the Full Quality window plus a margin; a finished make's (its
 * approval copies it into the trend's storage) once both are 30 days old; an
 * unknown, unfinished or unreadable job's, and any key outside the prefix,
 * stay. The bytes go back to the owner's storage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const h = vi.hoisted(() => ({
  list: vi.fn(),
  del: vi.fn(),
  configured: vi.fn(() => true),
  usage: vi.fn(async () => {}),
  rows: [] as Array<Record<string, unknown>>,
  readError: null as null | { message: string },
  queried: [] as string[][],
  selects: [] as string[],
}))

vi.mock("../storage.js", () => ({ listObjectsByPrefixWithMeta: h.list, isStorageConfigured: h.configured }))
vi.mock("../storage-delete.js", () => ({ deleteKeysRecordingFailures: h.del }))
vi.mock("../../utils/file-validation.js", () => ({ updateStorageUsage: h.usage }))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      expect(table).toBe("jobs")
      return {
        select: (cols: string) => {
          h.selects.push(cols)
          return {
            in: async (col: string, ids: string[]) => {
              expect(col).toBe("id")
              h.queried.push(ids)
              return h.readError ? { data: null, error: h.readError } : { data: h.rows.filter((r) => ids.includes(String(r.id))), error: null }
            },
          }
        },
      }
    },
  },
}))

import {
  CAST_SWAP_DEPTH_CLIPS_PREFIX,
  CAST_SWAP_FULL_QUALITY_WINDOW_MS,
  DEPTH_CLIP_MAKE_RETENTION_MS,
  DEPTH_CLIP_RETENTION_MS,
  jobIdOfDepthClipKey,
  startCastSwapDepthClipsSweep,
  sweepCastSwapDepthClips,
} from "../cast-swap-depth-clips-sweep.js"

const NOW = Date.parse("2026-11-20T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (d: number) => new Date(NOW - d * DAY)
const iso = (d: number) => daysAgo(d).toISOString()
const RUN = "11111111-1111-4111-8111-111111111111"
const FQ = "22222222-2222-4222-8222-222222222222"
const MAKE = "33333333-3333-4333-8333-333333333333"
const LIVE = "44444444-4444-4444-8444-444444444444"
const GONE = "55555555-5555-4555-8555-555555555555"
const RECENT = "66666666-6666-4666-8666-666666666666"
const OTHER = "77777777-7777-4777-8777-777777777777"
const NEW_MAKE = "88888888-8888-4888-8888-888888888888"
const RUNNING_MAKE = "99999999-9999-4999-8999-999999999999"
const key = (job: string, attempt = "first", nonce = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee") => `${CAST_SWAP_DEPTH_CLIPS_PREFIX}${job}-${attempt}-${nonce}.mp4`

beforeEach(() => {
  h.list.mockReset()
  h.del.mockReset().mockImplementation(async (keys: string[]) => ({ deleted: keys.length, errors: 0, notDeleted: [], kept: [], failed: [] }))
  h.configured.mockReset().mockReturnValue(true)
  h.usage.mockReset().mockResolvedValue(undefined)
  h.readError = null
  h.queried = []
  h.selects = []
  h.rows = [
    { id: RUN, user_id: "u1", status: "completed", completed_at: iso(20), job_type: "cast-swap", kind: "cast-swap" },
    { id: FQ, user_id: "u1", status: "failed", completed_at: null, job_type: "cast-swap-full-quality", kind: "cast-swap" },
    { id: MAKE, user_id: "admin", status: "completed", completed_at: iso(60), job_type: "cast-swap-face-mask", kind: "cast-swap-face-mask" },
    { id: LIVE, user_id: "u2", status: "processing", completed_at: null, job_type: "cast-swap", kind: "cast-swap" },
    // Completed only 8 days ago (its map written longer ago): still inside window + margin.
    { id: RECENT, user_id: "u2", status: "completed", completed_at: iso(8), job_type: "cast-swap", kind: "cast-swap" },
    { id: OTHER, user_id: "u3", status: "completed", completed_at: iso(60), job_type: "generate-video", kind: "generate-video" },
    { id: NEW_MAKE, user_id: "admin", status: "completed", completed_at: iso(20), job_type: "cast-swap-face-mask", kind: "cast-swap-face-mask" },
    { id: RUNNING_MAKE, user_id: "admin", status: "processing", completed_at: null, job_type: "cast-swap-face-mask", kind: "cast-swap-face-mask" },
  ]
})

describe("sweepCastSwapDepthClips", () => {
  it("is the engine's prefix: a run's past the Full Quality window (7 days) plus 2 days, a make's past 30 days", () => {
    expect(CAST_SWAP_DEPTH_CLIPS_PREFIX).toBe("cast-swap/depth-clips/")
    expect(CAST_SWAP_FULL_QUALITY_WINDOW_MS).toBe(7 * DAY)
    expect(DEPTH_CLIP_RETENTION_MS).toBe(9 * DAY)
    expect(DEPTH_CLIP_MAKE_RETENTION_MS).toBe(30 * DAY)
  })

  it("deletes a finished make's map (approval copied it into the trend's storage) once it and its job are 30 days old", async () => {
    h.list.mockResolvedValue([
      { key: key(MAKE), lastModified: daysAgo(60), size: 700 },
      { key: key(NEW_MAKE), lastModified: daysAgo(21), size: 1 },
      { key: key(RUNNING_MAKE), lastModified: daysAgo(40), size: 1 },
    ])
    const r = await sweepCastSwapDepthClips(NOW)
    expect(h.del.mock.calls[0]![0]).toEqual([key(MAKE)])
    expect(h.usage).toHaveBeenCalledWith("admin", -700)
    expect(r).toEqual({ listed: 3, deleted: 1, failed: 0, kept: 2, skipped: 0 })
  })

  it("reads the job a key names", () => {
    expect(jobIdOfDepthClipKey(key(RUN))).toBe(RUN)
    expect(jobIdOfDepthClipKey(key(RUN, "retry"))).toBe(RUN)
    expect(jobIdOfDepthClipKey(key(RUN.toUpperCase()))).toBe(RUN)
    for (const k of [`${CAST_SWAP_DEPTH_CLIPS_PREFIX}not-a-job.mp4`, `${CAST_SWAP_DEPTH_CLIPS_PREFIX}x/${RUN}-first-n.mp4`, `cast-swap/masked-clips/${RUN}-first-n.mp4`, `${CAST_SWAP_DEPTH_CLIPS_PREFIX}${RUN}.mp4`]) {
      expect(jobIdOfDepthClipKey(k), k).toBeNull()
    }
  })

  it("deletes a finished run's and Full Quality's maps past the retention, and gives the bytes back", async () => {
    h.list.mockResolvedValue([
      { key: key(RUN), lastModified: daysAgo(21), size: 1000 },
      { key: key(RUN, "retry"), lastModified: daysAgo(21), size: 500 },
      { key: key(FQ), lastModified: daysAgo(10), size: 300 },
    ])
    const r = await sweepCastSwapDepthClips(NOW)
    expect(h.list).toHaveBeenCalledWith("cast-swap/depth-clips/")
    expect(h.del).toHaveBeenCalledTimes(1)
    expect(h.del.mock.calls[0]![0]).toEqual([key(RUN), key(RUN, "retry"), key(FQ)])
    expect(h.del.mock.calls[0]![1]).toBe("cast-swap-depth-clip")
    expect(h.del.mock.calls[0]![2].jobIdOf(key(FQ))).toBe(FQ)
    expect(h.usage).toHaveBeenCalledWith("u1", -1800)
    expect(r).toEqual({ listed: 3, deleted: 3, failed: 0, kept: 0, skipped: 0 })
  })

  it("keeps a young make's map, an unfinished, unknown or other job's, and one completed inside the window + margin", async () => {
    h.list.mockResolvedValue([
      { key: key(NEW_MAKE), lastModified: daysAgo(25), size: 1 },
      { key: key(LIVE), lastModified: daysAgo(30), size: 1 },
      { key: key(GONE), lastModified: daysAgo(30), size: 1 },
      { key: key(RECENT), lastModified: daysAgo(12), size: 1 },
      { key: key(OTHER), lastModified: daysAgo(60), size: 1 },
      { key: `${CAST_SWAP_DEPTH_CLIPS_PREFIX}no-job.mp4`, lastModified: daysAgo(60), size: 1 },
    ])
    const r = await sweepCastSwapDepthClips(NOW)
    expect(h.del).not.toHaveBeenCalled()
    expect(h.usage).not.toHaveBeenCalled()
    expect(r).toEqual({ listed: 6, deleted: 0, failed: 0, kept: 6, skipped: 0 })
  })

  it("never looks at a map younger than the retention, or one whose age storage does not report", async () => {
    h.list.mockResolvedValue([
      { key: key(RUN), lastModified: daysAgo(8), size: 1 },
      { key: key(RUN, "retry"), size: 1 },
    ])
    const r = await sweepCastSwapDepthClips(NOW)
    expect(h.queried).toEqual([])
    expect(h.del).not.toHaveBeenCalled()
    expect(r).toEqual({ listed: 2, deleted: 0, failed: 0, kept: 0, skipped: 0 })
  })

  it("never deletes a key outside the prefix, even when listed", async () => {
    h.list.mockResolvedValue([
      { key: `cast-swap/masked-clips/${RUN}-first-n.mp4`, lastModified: daysAgo(60), size: 1 },
      { key: `videos/${RUN}.mp4`, lastModified: daysAgo(60), size: 1 },
    ])
    const r = await sweepCastSwapDepthClips(NOW)
    expect(h.del).not.toHaveBeenCalled()
    expect(r).toEqual({ listed: 2, deleted: 0, failed: 0, kept: 0, skipped: 2 })
  })

  it("deletes nothing when the jobs cannot be read, or the listing fails", async () => {
    h.list.mockResolvedValue([{ key: key(RUN), lastModified: daysAgo(30), size: 1 }])
    h.readError = { message: "down" }
    expect(await sweepCastSwapDepthClips(NOW)).toEqual({ listed: 1, deleted: 0, failed: 1, kept: 0, skipped: 0 })
    expect(h.del).not.toHaveBeenCalled()
    h.list.mockRejectedValue(new Error("list failed"))
    expect(await sweepCastSwapDepthClips(NOW)).toEqual({ listed: 0, deleted: 0, failed: 1, kept: 0, skipped: 0 })
  })

  it("gives back only what storage deleted, and counts what it did not", async () => {
    h.list.mockResolvedValue([
      { key: key(RUN), lastModified: daysAgo(30), size: 1000 },
      { key: key(RUN, "retry"), lastModified: daysAgo(30), size: 500 },
    ])
    h.del.mockImplementation(async () => ({ deleted: 1, errors: 1, notDeleted: [key(RUN, "retry")], kept: [], failed: [key(RUN, "retry")] }))
    const r = await sweepCastSwapDepthClips(NOW)
    expect(h.usage).toHaveBeenCalledWith("u1", -1000)
    expect(r).toEqual({ listed: 2, deleted: 1, failed: 1, kept: 0, skipped: 0 })
  })

  it("reads the jobs in batches of 100, by the id each key names", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`)
    h.list.mockResolvedValue(ids.map((id) => ({ key: key(id), lastModified: daysAgo(30), size: 1 })))
    await sweepCastSwapDepthClips(NOW)
    expect(h.queried.map((q) => q.length)).toEqual([100, 50])
    expect(h.selects[0]).toBe("id, user_id, status, completed_at, job_type, kind:input_data->>type")
  })
})

describe("startCastSwapDepthClipsSweep", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("is a no-op without object storage", async () => {
    h.configured.mockReturnValue(false)
    const stop = startCastSwapDepthClipsSweep(() => {})
    await stop()
    expect(h.list).not.toHaveBeenCalled()
  })

  it("sweeps on boot and reports a failure", async () => {
    h.list.mockRejectedValue(new Error("down"))
    const report = vi.fn()
    const stop = startCastSwapDepthClipsSweep(report)
    await stop()
    expect(h.list).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith(expect.stringContaining("1 failed"))
  })
})
