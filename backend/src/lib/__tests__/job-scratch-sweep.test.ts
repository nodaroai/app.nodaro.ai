/**
 * The scratch-folder age sweep (decided 2026-10-09, round 3 of the expiry
 * walk): a backstop that deletes temporary provider uploads older than 7 days.
 * A job's end empties its scratch folder; a worker that dies before its
 * `finally`, a job the reconcile cron ends, or a self-heal left to reconcile
 * leaves the folder behind. Nothing reads one after its job is over, so the
 * sweep goes by age alone, deletes through the storage-delete funnel (a
 * failure is recorded for the retry pass) and runs on every edition.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockList, mockDelete, mockConfigured } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockDelete: vi.fn(),
  mockConfigured: vi.fn(() => true),
}))

vi.mock("../storage.js", () => ({
  listObjectsByPrefixWithMeta: mockList,
  isStorageConfigured: mockConfigured,
}))
vi.mock("../storage-delete.js", () => ({
  deleteKeysRecordingFailures: mockDelete,
}))

import { JOB_SCRATCH_ROOT, jobScratchKey } from "../job-scratch-keys.js"
import { assertOrdinaryMediaKey } from "../retained-image-keys.js"
import {
  JOB_SCRATCH_MAX_AGE_MS,
  startJobScratchSweep,
  sweepJobScratch,
} from "../job-scratch-sweep.js"

const NOW = Date.parse("2026-10-09T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (d: number) => new Date(NOW - d * DAY)
const JOB_A = "11111111-2222-4333-8444-555555555555"
const JOB_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const inFolder = (jobId: string, file: string) => `${JOB_SCRATCH_ROOT}${jobId}/${file}`
const flat = (file: string) => `${JOB_SCRATCH_ROOT}${file}`

type Opts = { jobIdOf?: (key: string) => string | null }

beforeEach(() => {
  mockList.mockReset()
  mockDelete.mockReset().mockImplementation(async (keys: string[]) => ({
    deleted: keys.length, errors: 0, notDeleted: [], kept: [], failed: [],
  }))
  mockConfigured.mockReset().mockReturnValue(true)
})

describe("sweepJobScratch", () => {
  it("sweeps the scratch root, with a 7-day age", async () => {
    mockList.mockResolvedValue([])
    await sweepJobScratch(NOW)
    expect(mockList).toHaveBeenCalledWith(JOB_SCRATCH_ROOT)
    expect(JOB_SCRATCH_MAX_AGE_MS).toBe(7 * DAY)
  })

  it("deletes only files strictly older than 7 days, in one call through the storage-delete funnel", async () => {
    mockList.mockResolvedValue([
      { key: inFolder(JOB_A, "extend-tail-1a2b3c4d.mp4"), lastModified: daysAgo(8) },
      { key: inFolder(JOB_A, "extend-last-frame-1a2b3c4d.png"), lastModified: daysAgo(8) },
      { key: inFolder(JOB_B, "lip-sync-trimmed-1a2b3c4d.mp3"), lastModified: daysAgo(1) },
      { key: inFolder(JOB_B, "motion-trimmed-1a2b3c4d.mp4"), lastModified: daysAgo(7) },
    ])

    const r = await sweepJobScratch(NOW)

    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockDelete.mock.calls[0]![0]).toEqual([
      inFolder(JOB_A, "extend-tail-1a2b3c4d.mp4"),
      inFolder(JOB_A, "extend-last-frame-1a2b3c4d.png"),
    ])
    expect(mockDelete.mock.calls[0]![1]).toBe("job-scratch")
    expect(r).toEqual({ listed: 4, deleted: 2, failed: 0, skipped: 0 })
  })

  it("also deletes the flat leftovers directly under the root: the pre-folder keys and the no-job key", async () => {
    mockList.mockResolvedValue([
      { key: flat("lip-sync-trimmed-1760000000000.mp3"), lastModified: daysAgo(90) },
      { key: flat("provider-converted-1760000000000-ab12cd.jpg"), lastModified: daysAgo(30) },
      { key: jobScratchKey(undefined, "resized-mask", "png"), lastModified: daysAgo(10) },
      { key: flat("motion-trimmed-1760000000000.mp4"), lastModified: daysAgo(2) },
    ])
    const r = await sweepJobScratch(NOW)
    expect(mockDelete.mock.calls[0]![0]).toHaveLength(3)
    expect(r.deleted).toBe(3)
  })

  it("records each file's job (the folder it is in) as provenance, and no job for a flat key", async () => {
    mockList.mockResolvedValue([
      { key: inFolder(JOB_A, "cover-src-1a2b3c4d.mp3"), lastModified: daysAgo(9) },
      { key: flat("lip-sync-trimmed-1760000000000.mp3"), lastModified: daysAgo(9) },
    ])
    await sweepJobScratch(NOW)
    const opts = mockDelete.mock.calls[0]![2] as Opts
    expect(opts.jobIdOf?.(inFolder(JOB_A, "cover-src-1a2b3c4d.mp3"))).toBe(JOB_A)
    expect(opts.jobIdOf?.(flat("lip-sync-trimmed-1760000000000.mp3"))).toBeNull()
    expect(opts.jobIdOf?.(`${JOB_SCRATCH_ROOT}not-a-job/x.mp3`)).toBeNull()
  })

  it("a scratch key is one the funnel records on failure (not refused as a retained-media key)", () => {
    // The funnel's `isRetryableDeleteKey` is exactly this check.
    expect(() => assertOrdinaryMediaKey(jobScratchKey(JOB_A, "extend-tail", "mp4"))).not.toThrow()
    expect(() => assertOrdinaryMediaKey(jobScratchKey(undefined, "lip-sync-trimmed", "mp3"))).not.toThrow()
  })

  it("leaves a file whose age it cannot prove", async () => {
    mockList.mockResolvedValue([{ key: inFolder(JOB_A, "no-date-1a2b3c4d.png") }])
    const r = await sweepJobScratch(NOW)
    expect(mockDelete).not.toHaveBeenCalled()
    expect(r.deleted).toBe(0)
  })

  it("never deletes a key outside the root, even if the listing returns one", async () => {
    mockList.mockResolvedValue([
      { key: `audios/cover-src-${JOB_A}.mp3`, lastModified: daysAgo(90) },
      { key: `tmp/other/${JOB_A}/x.mp4`, lastModified: daysAgo(90) },
      { key: inFolder(JOB_A, "old-1a2b3c4d.mp4"), lastModified: daysAgo(90) },
    ])
    const r = await sweepJobScratch(NOW)
    expect(mockDelete.mock.calls[0]![0]).toEqual([inFolder(JOB_A, "old-1a2b3c4d.mp4")])
    expect(r.skipped).toBe(2)
  })

  it("makes no delete call when nothing is listed (community with no provider work: the root never exists)", async () => {
    mockList.mockResolvedValue([])
    const r = await sweepJobScratch(NOW)
    expect(mockDelete).not.toHaveBeenCalled()
    expect(r).toEqual({ listed: 0, deleted: 0, failed: 0, skipped: 0 })
  })

  it("counts a listing failure instead of throwing", async () => {
    mockList.mockRejectedValue(new Error("NoSuchBucket"))
    const r = await sweepJobScratch(NOW)
    expect(r.failed).toBe(1)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("counts the files storage did not delete (the funnel recorded them), and a throwing call, instead of throwing", async () => {
    const a = inFolder(JOB_A, "a-1a2b3c4d.mp4")
    const b = inFolder(JOB_A, "b-1a2b3c4d.mp4")
    mockList.mockResolvedValue([
      { key: a, lastModified: daysAgo(10) },
      { key: b, lastModified: daysAgo(10) },
    ])
    mockDelete.mockResolvedValueOnce({ deleted: 1, errors: 1, notDeleted: [b], kept: [], failed: [b] })
    expect(await sweepJobScratch(NOW)).toMatchObject({ deleted: 1, failed: 1 })

    mockDelete.mockRejectedValueOnce(new Error("boom"))
    expect(await sweepJobScratch(NOW)).toMatchObject({ deleted: 0, failed: 2 })
  })

  it("is idempotent: a second run over the same listing asks for the same deletes", async () => {
    const k = inFolder(JOB_A, "old-1a2b3c4d.mp4")
    mockList.mockResolvedValue([{ key: k, lastModified: daysAgo(9) }])
    await sweepJobScratch(NOW)
    await sweepJobScratch(NOW)
    expect(mockDelete.mock.calls.map((c) => c[0])).toEqual([[k], [k]])
  })
})

describe("startJobScratchSweep", () => {
  afterEach(() => { vi.useRealTimers() })

  it("does nothing at all when storage is not configured", async () => {
    mockConfigured.mockReturnValue(false)
    const stop = startJobScratchSweep(() => {})
    await stop()
    expect(mockList).not.toHaveBeenCalled()
  })

  it("sweeps once on start, then once a day, and stops cleanly", async () => {
    vi.useFakeTimers()
    mockList.mockResolvedValue([])
    const stop = startJobScratchSweep(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(mockList).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DAY)
    expect(mockList).toHaveBeenCalledTimes(2)
    await stop()
    await vi.advanceTimersByTimeAsync(DAY)
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it("reports a sweep that could not finish", async () => {
    vi.useFakeTimers()
    mockList.mockRejectedValue(new Error("down"))
    const report = vi.fn()
    const stop = startJobScratchSweep(report)
    await vi.advanceTimersByTimeAsync(0)
    expect(report).toHaveBeenCalledTimes(1)
    await stop()
  })
})
