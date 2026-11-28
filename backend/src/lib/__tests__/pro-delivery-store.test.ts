// @test-watches backend/src/lib/pro-delivery-store.ts
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { storeProDeliveryClip } from "../pro-delivery-store.js"

const h = vi.hoisted(() => ({
  job: vi.fn(), clock: vi.fn(), record: vi.fn(), readBack: vi.fn(), discard: vi.fn(), unknown: vi.fn(),
  kept: vi.fn(), deleteUnnamed: vi.fn(), head: vi.fn(), store: vi.fn(), download: vi.fn(),
}))
vi.mock("../supabase.js", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: h.job }) }) }) } }))
vi.mock("../config.js", () => ({ hasCredits: () => true }))
vi.mock("../job-cancellation.js", () => ({ getJobId: () => "j1", JobCancelledError: class extends Error {} }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: () => mkdtemp(join(tmpdir(), "pro-store-test-")), cleanupWorkDir: (dir: string) => rm(dir, { recursive: true, force: true }), downloadFile: h.download,
}))
vi.mock("../storage.js", () => ({
  headR2Object: h.head, mediaObjectKey: (id: string) => `videos/${id}.mp4`, r2Url: (key: string) => `https://media.test/${key}`,
}))
vi.mock("../job-server-output.js", () => ({
  storeBeginTime: h.clock, recordStoredObjectAndCharge: h.record, readServerOutput: h.readBack,
  discardJustStored: h.discard, discardIfNeverRecorded: h.unknown, deliveredKeepsKey: h.kept, deleteUnnamedDeliveredObject: h.deleteUnnamed,
}))
vi.mock("../video-result-store.js", () => ({ storeVideoResult: h.store }))

const input = { jobId: "j1", segment: 1, userId: "u1", sourceUrl: "https://media.test/source", watermark: false }
const row = { user_id: "u1", job_type: "edit-video-pro", should_watermark: false, status: "processing" }
const objects = new Map<string, number>()
const tracked = new Map<string, number>()
beforeEach(() => {
  vi.resetAllMocks()
  objects.clear()
  tracked.clear()
  h.job.mockResolvedValue({ data: row, error: null })
  h.download.mockImplementation(async (_url, path) => writeFile(path, "clip"))
  h.clock.mockResolvedValue("before-upload")
  h.head.mockImplementation(async key => objects.has(key) ? { exists: true, sizeBytes: objects.get(key) } : { exists: false })
  h.store.mockImplementation(async (_src, opts) => {
    const key = `videos/${opts.jobId}.mp4`
    objects.set(key, 12)
    return { videoUrl: `https://media.test/${key}` }
  })
  h.record.mockImplementation(async ({ key, bytes }) => {
    const previous = tracked.get(key) ?? 0
    tracked.set(key, Math.max(previous, bytes))
    return { outcome: "recorded", charged: Math.max(0, bytes - previous) }
  })
  h.readBack.mockImplementation(async () => ({ serverOutput: { stored: Object.fromEntries(tracked) } }))
})

describe("Pro delivery clip storage", () => {
  it("charges real bytes once after two submits, even if the same source arrives at a new scratch URL", async () => {
    const first = await storeProDeliveryClip(input)
    expect(await storeProDeliveryClip({ ...input, sourceUrl: "https://media.test/new" })).toBe(first)
    expect(h.store).toHaveBeenCalledOnce()
    expect(h.store.mock.calls[0]![1]).toMatchObject({ userId: undefined, original: "never", watermark: false })
    expect([...tracked.values()]).toEqual([12])
    expect(h.clock.mock.invocationCallOrder[0]).toBeLessThan(h.store.mock.invocationCallOrder[0]!)
  })

  it("uses different keys for new source bytes and required watermarks", async () => {
    const a = await storeProDeliveryClip(input)
    h.job.mockResolvedValue({ data: { ...row, should_watermark: true }, error: null })
    const b = await storeProDeliveryClip(input)
    h.download.mockImplementation(async (_url, path) => writeFile(path, "changed clip"))
    const c = await storeProDeliveryClip(input)
    expect(new Set([a,b,c]).size).toBe(3)
    expect(h.store.mock.calls[1]![1].watermark).toBe(true)
  })

  it.each(["pending_review", "completed"])("retains an already named clip when the job is %s", async status => {
    const a = await storeProDeliveryClip(input)
    h.job.mockResolvedValue({ data: { ...row, status }, error: null })
    h.kept.mockResolvedValue("named")
    expect(await storeProDeliveryClip(input)).toBe(a)
    expect(h.store).toHaveBeenCalledOnce()
    expect(h.discard).not.toHaveBeenCalled()
    expect(h.deleteUnnamed).not.toHaveBeenCalled()
  })

  it("cannot publish a zero-byte staging placeholder as a confirmed storage receipt", async () => {
    h.record.mockResolvedValue({ outcome: "recorded", charged: 0 })
    await expect(storeProDeliveryClip(input)).rejects.toThrow("storage receipt")
    expect(h.store).toHaveBeenCalledOnce()
    expect(h.discard).not.toHaveBeenCalled()
  })

  it("does not upload anything when bucket HEAD fails", async () => {
    h.head.mockRejectedValue(new Error("HEAD unavailable"))
    await expect(storeProDeliveryClip(input)).rejects.toThrow("HEAD unavailable")
    expect(h.store).not.toHaveBeenCalled()
    expect(h.record).not.toHaveBeenCalled()
  })

  it("cannot store a clip for a different owner/job", async () => {
    await expect(storeProDeliveryClip({ ...input, userId: "other" })).rejects.toThrow()
    await expect(storeProDeliveryClip({ ...input, jobId: "other" })).rejects.toThrow()
    expect(h.store).not.toHaveBeenCalled()
  })

  it.each(["ended", "unknown", "unrecorded", "delivered"])("handles a %s final record after the bytes were uploaded", async outcome => {
    h.record.mockResolvedValueOnce({ outcome: "recorded", charged: 0 }).mockResolvedValueOnce({ outcome })
    h.kept.mockResolvedValue("unnamed")
    await expect(storeProDeliveryClip(input)).rejects.toThrow()
    expect(h.store).toHaveBeenCalledOnce()
    if (outcome === "unknown") {
      expect(h.discard).not.toHaveBeenCalled()
      expect(h.deleteUnnamed).not.toHaveBeenCalled()
      expect(h.unknown).not.toHaveBeenCalled()
    }
    if (outcome === "unrecorded" || outcome === "ended") expect(h.discard).toHaveBeenCalledWith("j1", expect.any(String), outcome)
    if (outcome === "delivered") expect(h.deleteUnnamed).toHaveBeenCalledOnce()
  })
})
