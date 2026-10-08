/**
 * The Speaker Frames checkpoint sweep (decided 2026-10-08): objects under
 * `speaker-frames-cache/` older than 7 days are deleted. The plugin deletes a
 * job's checkpoints on every exit it sees as terminal; only an attempt the
 * worker never returns from leaves them behind, and nothing in the database
 * names them — so the sweep is by age alone, owner-agnostic, and runs on every
 * edition (on community the prefix simply never exists).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { mockList, mockBatchDelete, mockConfigured } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockConfigured: vi.fn(() => true),
}))

vi.mock("../storage.js", () => ({
  listObjectsByPrefixWithMeta: mockList,
  batchDeleteFromR2: mockBatchDelete,
  isStorageConfigured: mockConfigured,
}))

import {
  SPEAKER_FRAMES_CACHE_MAX_AGE_MS,
  SPEAKER_FRAMES_CACHE_PREFIX,
  startSpeakerFramesCacheSweep,
  sweepSpeakerFramesCache,
} from "../speaker-frames-cache-sweep.js"

const NOW = Date.parse("2026-10-08T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (d: number) => new Date(NOW - d * DAY)
const key = (fp: string) => `${SPEAKER_FRAMES_CACHE_PREFIX}${fp}.json`

beforeEach(() => {
  mockList.mockReset()
  mockBatchDelete.mockReset().mockImplementation(async (keys: string[]) => ({ deleted: keys.length, errors: 0 }))
  mockConfigured.mockReset().mockReturnValue(true)
})

describe("sweepSpeakerFramesCache", () => {
  it("is the plugin's checkpoint prefix, with a trailing slash, and a 7-day age", () => {
    expect(SPEAKER_FRAMES_CACHE_PREFIX).toBe("speaker-frames-cache/")
    expect(SPEAKER_FRAMES_CACHE_MAX_AGE_MS).toBe(7 * DAY)
  })

  it("deletes only objects strictly older than 7 days, in one batched call", async () => {
    mockList.mockResolvedValue([
      { key: key("old-1"), lastModified: daysAgo(8) },
      { key: key("old-2"), lastModified: daysAgo(30) },
      { key: key("fresh"), lastModified: daysAgo(1) },
      { key: key("edge"), lastModified: daysAgo(7) },
    ])

    const r = await sweepSpeakerFramesCache(NOW)

    expect(mockList).toHaveBeenCalledWith("speaker-frames-cache/")
    expect(mockBatchDelete).toHaveBeenCalledTimes(1)
    expect(mockBatchDelete).toHaveBeenCalledWith([key("old-1"), key("old-2")])
    expect(r).toEqual({ listed: 4, deleted: 2, failed: 0, skipped: 0 })
  })

  it("leaves an object whose age it cannot prove", async () => {
    mockList.mockResolvedValue([{ key: key("no-date") }])
    const r = await sweepSpeakerFramesCache(NOW)
    expect(mockBatchDelete).not.toHaveBeenCalled()
    expect(r.deleted).toBe(0)
  })

  it("never deletes a key outside the prefix, even if the listing returns one", async () => {
    mockList.mockResolvedValue([
      { key: `speaker-tracks/00000000-0000-4000-8000-000000000001.json`, lastModified: daysAgo(90) },
      { key: `speaker-frames-cache-archive/x.json`, lastModified: daysAgo(90) },
      { key: key("old"), lastModified: daysAgo(90) },
    ])
    const r = await sweepSpeakerFramesCache(NOW)
    expect(mockBatchDelete).toHaveBeenCalledWith([key("old")])
    expect(r.skipped).toBe(2)
  })

  it("issues no delete when nothing is listed (community: the prefix never exists)", async () => {
    mockList.mockResolvedValue([])
    const r = await sweepSpeakerFramesCache(NOW)
    expect(mockBatchDelete).not.toHaveBeenCalled()
    expect(r).toEqual({ listed: 0, deleted: 0, failed: 0, skipped: 0 })
  })

  it("counts a listing failure instead of throwing", async () => {
    mockList.mockRejectedValue(new Error("NoSuchBucket"))
    const r = await sweepSpeakerFramesCache(NOW)
    expect(r.failed).toBe(1)
    expect(mockBatchDelete).not.toHaveBeenCalled()
  })

  it("counts per-key delete errors and a rejected batch instead of throwing", async () => {
    mockList.mockResolvedValue([
      { key: key("a"), lastModified: daysAgo(10) },
      { key: key("b"), lastModified: daysAgo(10) },
    ])
    mockBatchDelete.mockResolvedValueOnce({ deleted: 1, errors: 1 })
    expect(await sweepSpeakerFramesCache(NOW)).toMatchObject({ deleted: 1, failed: 1 })

    mockBatchDelete.mockRejectedValueOnce(new Error("boom"))
    expect(await sweepSpeakerFramesCache(NOW)).toMatchObject({ deleted: 0, failed: 2 })
  })

  it("is idempotent: a second run over the same listing asks for the same deletes", async () => {
    mockList.mockResolvedValue([{ key: key("old"), lastModified: daysAgo(9) }])
    await sweepSpeakerFramesCache(NOW)
    await sweepSpeakerFramesCache(NOW)
    expect(mockBatchDelete.mock.calls).toEqual([[[key("old")]], [[key("old")]]])
  })
})

describe("startSpeakerFramesCacheSweep", () => {
  afterEach(() => { vi.useRealTimers() })

  it("does nothing at all when storage is not configured", async () => {
    mockConfigured.mockReturnValue(false)
    const stop = startSpeakerFramesCacheSweep(() => {})
    await stop()
    expect(mockList).not.toHaveBeenCalled()
  })

  it("sweeps once on start, then once a day, and stops cleanly", async () => {
    vi.useFakeTimers()
    mockList.mockResolvedValue([])
    const stop = startSpeakerFramesCacheSweep(() => {})
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
    const stop = startSpeakerFramesCacheSweep(report)
    await vi.advanceTimersByTimeAsync(0)
    expect(report).toHaveBeenCalledTimes(1)
    await stop()
  })
})
