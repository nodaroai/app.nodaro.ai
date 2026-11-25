// @test-reads-none every file it names is mocked
/**
 * The video result funnel's rule (`lib/video-result-store.ts`, decided
 * 2026-11-22), with storage, ffprobe and the encodes mocked: what is stored,
 * where, in which order, and what the job's output records.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  uploads: [] as Array<{ path: string; id: string; ext?: string }>,
  probeJson: "",
  /** Answers for the next probes, in order (an Error throws); then `probeJson`. */
  probes: [] as Array<string | Error>,
  previewFails: false as boolean | Error,
  previewUploadFails: false,
  charges: [] as Array<{ jobId: string; key: string; bytes: number }>,
  decodes: true as boolean | "unknown",
  delivered: "named" as "named" | "unnamed" | "unknown",
  deliveredDeleted: [] as string[],
  neverRecordedDiscards: [] as string[],
  /** What the next record call comes to (`recordStoredObjectAndCharge`). */
  outcome: "recorded" as "recorded" | "ended" | "delivered" | "unrecorded" | "unknown",
  streamed: [] as string[],
  emptyFile: false,
  finalAttempt: undefined as boolean | undefined,
  reconcileLast: false,
  before: vi.fn(async (_in: string, out: string, _crf?: string) => out),
  runningJob: undefined as string | undefined,
  deleted: [] as string[],
  signals: [] as Array<AbortSignal | undefined>,
  watermark: vi.fn(async () => {}),
  preview: vi.fn(async (_in: string, out: string, _probe?: unknown, _crf?: string) => out),
}))

vi.mock("../storage.js", () => ({
  mediaObjectKey: (id: string, type: string, ext = "mp4") => `${type}s/${id}.${ext}`,
  uploadFileToR2: vi.fn(async (path: string, id: string, _type: string, _user: string | undefined, opts: { ext?: string } = {}) => {
    if (m.previewUploadFails && path.endsWith("preview.mp4")) throw new Error("R2 PUT failed")
    m.uploads.push({ path, id, ...(opts.ext ? { ext: opts.ext } : {}) })
    return `https://cdn.test/videos/${id}.${opts.ext ?? "mp4"}`
  }),
  uploadToR2: vi.fn(async (_url: string, id: string, _type: string, _user: string | undefined, opts: { ext?: string } = {}) => {
    m.streamed.push(id)
    m.uploads.push({ path: "<fetched>", id, ...(opts.ext ? { ext: opts.ext } : {}) })
    return `https://cdn.test/videos/${id}.${opts.ext ?? "mp4"}`
  }),
}))
vi.mock("node:fs/promises", async (orig) => ({
  ...(await orig<object>()),
  stat: vi.fn(async () => ({ size: m.emptyFile ? 0 : 1234 })),
}))
vi.mock("../../utils/watermark.js", () => ({ applyVideoWatermark: m.watermark }))
vi.mock("../../providers/video/ffmpeg-utils.js", async (orig) => ({
  ...(await orig<object>()),
  createWorkDir: vi.fn(async () => "/tmp/vstore-test"),
  cleanupWorkDir: vi.fn(async () => {}),
  downloadFile: vi.fn(async () => {}),
  transcodeToBrowserSafe: vi.fn(async (input: string, output: string, crf?: string) => m.before(input, output, crf)),
  runFfprobe: vi.fn(async () => {
    const next = m.probes.shift()
    if (next instanceof Error) throw next
    return next ?? m.probeJson
  }),
}))
vi.mock("../../providers/video/browser-safe-preview.js", async (orig) => ({
  ...(await orig<object>()),
  pictureDecodes: vi.fn(async () => (m.decodes === "unknown" ? { unknown: new Error("spawn EAGAIN") } : m.decodes ? "yes" : "no")),
  encodeBrowserSafePreview: vi.fn(async (input: string, output: string, probe: unknown, crf?: string, signal?: AbortSignal) => {
    m.signals.push(signal)
    if (m.previewFails instanceof Error) throw m.previewFails
    if (m.previewFails) throw Object.assign(new Error("ffmpeg timed out"), { killed: true, timedOut: true })
    return m.preview(input, output, probe, crf)
  }),
}))

vi.mock("../job-server-output.js", async (orig) => ({
  ...(await orig<object>()),
  recordStoredObjectAndCharge: vi.fn(async (a: { jobId: string; key: string; bytes: number }) => {
    if (m.outcome !== "recorded") return { outcome: m.outcome }
    m.charges.push({ jobId: a.jobId, key: a.key, bytes: a.bytes })
    return { outcome: "recorded", charged: a.bytes }
  }),
  storeBeginTime: vi.fn(async () => "2026-11-23T10:00:00.000Z"),
  deliveredKeepsKey: vi.fn(async () => m.delivered),
  deleteUnnamedDeliveredObject: vi.fn(async (_jobId: string, key: string) => { m.deliveredDeleted.push(key) }),
  discardIfNeverRecorded: vi.fn(async (_jobId: string, key: string) => { m.neverRecordedDiscards.push(key) }),
  discardJustStored: vi.fn(async (_jobId: string, key: string, _why: string) => { m.deleted.push(key) }),
  // The worker's flag where a job context carries it, else the reconcile count.
  isLastAttempt: vi.fn(async (_jobId: string, fromContext: boolean | undefined) => fromContext ?? m.reconcileLast),
}))
vi.mock("../supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: "processing" }, error: null }) }) }) }) },
}))
vi.mock("../job-cancellation.js", async (orig) => ({ ...(await orig<object>()), getJobId: () => m.runningJob, isFinalAttemptOfRunningJob: () => m.finalAttempt }))

import { isPreviewEncodeFailure, storeVideoAsIs, storedVideoFields, storeVideoResult } from "../video-result-store.js"
import { isPostProcessingError } from "../post-processing-error.js"

const probe = (stream: Record<string, unknown>, format: Record<string, unknown> = { format_name: "mov,mp4,m4a,3gp,3g2,mj2", tags: { major_brand: "isom" } }) =>
  JSON.stringify({ streams: [{ codec_type: "video", width: 1920, height: 1080, ...stream }], format })

const H264 = probe({ codec_name: "h264", pix_fmt: "yuv420p", color_transfer: "bt709" })
const HEVC_10BIT = probe({ codec_name: "hevc", pix_fmt: "yuv420p10le", color_transfer: "bt709", color_primaries: "bt709", color_space: "bt709" })
const HEVC_HLG = probe({ codec_name: "hevc", pix_fmt: "yuv420p10le", color_transfer: "arib-std-b67", color_primaries: "bt2020", color_space: "bt2020nc" })

const JOB = "11111111-2222-4333-8444-555555555555"
const OPTS = { jobId: JOB, userId: "user-1", watermark: false }
const AUDIO_ONLY = JSON.stringify({ streams: [{ codec_type: "audio", codec_name: "aac" }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" } })

beforeEach(() => {
  m.uploads.length = 0
  m.probes.length = 0
  m.charges.length = 0
  m.previewFails = false
  m.previewUploadFails = false
  m.decodes = true
  m.delivered = "named"
  m.deliveredDeleted.length = 0
  m.neverRecordedDiscards.length = 0
  m.outcome = "recorded"
  m.streamed.length = 0
  m.emptyFile = false
  m.finalAttempt = undefined
  m.reconcileLast = false
  m.before.mockClear()
  m.runningJob = undefined
  m.deleted.length = 0
  m.signals.length = 0
  m.watermark.mockClear()
  m.preview.mockClear()
})

describe("storeVideoResult", () => {
  it("an 8-bit H.264 file: stored as it is, no original", async () => {
    m.probeJson = H264
    const stored = await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)
    expect(stored).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.uploads.map((u) => u.id)).toEqual([JOB])
    expect(m.preview).not.toHaveBeenCalled()
  })

  it("a 10-bit HEVC SDR file: the original first, untouched, then its preview", async () => {
    m.probeJson = HEVC_10BIT
    const stored = await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)
    expect(m.uploads).toEqual([
      { path: "/tmp/vstore-test/input.mp4", id: `${JOB}-master`, ext: "mp4" },
      { path: "/tmp/vstore-test/preview.mp4", id: JOB },
    ])
    expect(stored).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4`, originalVideoUrl: `https://cdn.test/videos/${JOB}-master.mp4` })
    expect(storedVideoFields(stored)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4`, originalVideoUrl: `https://cdn.test/videos/${JOB}-master.mp4` })
  })

  it("an HLG file: original + preview (the preview's tone map is the encode's own, browser-safe-preview.test.ts)", async () => {
    m.probeJson = HEVC_HLG
    const stored = await storeVideoResult({ path: "/work/merged.mp4" }, { ...OPTS, jobId: `${JOB}-merged` })
    expect(m.uploads.map((u) => u.id)).toEqual([`${JOB}-merged-master`, `${JOB}-merged`])
    expect(m.preview).toHaveBeenCalledWith("/work/merged.mp4", "/tmp/vstore-test/preview.mp4", expect.objectContaining({ colorTransfer: "arib-std-b67" }), undefined)
    // The job's cancel reaches the running encode.
    expect(m.signals[0]).toBeInstanceOf(AbortSignal)
    expect(stored.originalVideoUrl).toBe(`https://cdn.test/videos/${JOB}-merged-master.mp4`)
  })

  it("keeps a QuickTime original as .mov, and passes the caller's CRF to the preview", async () => {
    m.probeJson = probe({ codec_name: "prores", pix_fmt: "yuv422p10le" }, { format_name: "mov,mp4,m4a,3gp,3g2,mj2", tags: { major_brand: "qt  " } })
    await storeVideoResult({ url: "https://provider/v.mov" }, { ...OPTS, crf: "18" })
    expect(m.uploads[0]).toMatchObject({ id: `${JOB}-master`, ext: "mov" })
    expect(m.preview).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.anything(), "18")
  })

  it("a watermarked run: the watermarked file alone, never an original or a preview", async () => {
    m.probeJson = HEVC_HLG
    const stored = await storeVideoResult({ url: "https://provider/v.mp4" }, { ...OPTS, watermark: true })
    expect(stored).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.uploads).toEqual([{ path: "/tmp/vstore-test/watermarked.mp4", id: JOB }])
    expect(m.watermark).toHaveBeenCalledTimes(1)
    expect(m.preview).not.toHaveBeenCalled()
  })

  it("a preview that fails: the job keeps the original, flagged as having no preview copy", async () => {
    m.probeJson = HEVC_10BIT
    m.previewFails = true
    const stored = await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)
    expect(stored).toEqual({
      videoUrl: `https://cdn.test/videos/${JOB}-master.mp4`,
      originalVideoUrl: `https://cdn.test/videos/${JOB}-master.mp4`,
      videoPreviewUnavailable: true,
    })
    expect(m.uploads.map((u) => u.id)).toEqual([`${JOB}-master`])
  })

  it("a drain or a cancel during the preview is not a failed preview: it stops the store", async () => {
    m.probeJson = HEVC_10BIT
    const drain = Object.assign(new Error("worker draining"), { name: "DrainAbortError" })
    m.previewFails = new Error("ffmpeg killed", { cause: drain })
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toThrow()
    m.previewFails = Object.assign(new Error("Job job-1 was cancelled"), { name: "JobCancelledError" })
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toThrow(/cancelled/)
  })

  it("a caller that keeps no original: the preview alone, and its failure fails the store", async () => {
    m.probeJson = HEVC_10BIT
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, { ...OPTS, original: "never" })).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.uploads.map((u) => u.id)).toEqual([JOB])
    m.previewFails = true
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, { ...OPTS, original: "never" })).rejects.toThrow(/timed out/)
  })
})

describe("a file the probe does not read as video is stored as before this funnel (no original, never a .bin)", () => {
  const failsAsBefore = async () => {
    // The plain browser-safe encode of something that is no video fails (for
    // sound alone, the preview has no video frame: video-result-store-media.test.ts).
    m.previewFails = true
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toThrow()
    expect(m.uploads).toEqual([])
    expect(m.charges).toEqual([])
  }

  it("an HTML error body (ffprobe cannot read it, twice)", async () => {
    m.probes.push(new Error("Invalid data found when processing input"), new Error("Invalid data found when processing input"))
    await failsAsBefore()
  })

  it("a truncated mp4 (moov atom not found)", async () => {
    m.probes.push(new Error("moov atom not found"), new Error("moov atom not found"))
    await failsAsBefore()
  })

  it("a file with sound alone", async () => {
    m.probeJson = AUDIO_ONLY
    await failsAsBefore()
  })

  it("a probe that throws once on a healthy H.264 file: asked again, stored as it is, no original", async () => {
    m.probes.push(new Error("ffprobe timed out"))
    m.probeJson = H264
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.uploads.map((u) => u.id)).toEqual([JOB])
    expect(m.charges).toEqual([])
  })
})

describe("only a genuine encode failure takes the no-preview fallback", () => {
  it("records and charges the original once, on its job", async () => {
    m.probeJson = HEVC_10BIT
    await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)
    expect(m.charges).toEqual([{ jobId: JOB, key: `videos/${JOB}-master.mp4`, bytes: expect.any(Number) }])
  })

  it.each([
    ["a drain", Object.assign(new Error("draining"), { name: "DrainAbortError" })],
    ["a cancel", Object.assign(new Error("Job x was cancelled"), { name: "JobCancelledError" })],
    ["an aborted launch (a job budget)", Object.assign(new Error("aborted"), { killed: false, timedOut: false, aborted: true })],
    ["a launch that never started", Object.assign(new Error("spawn EAGAIN"), { killed: false, timedOut: false, notStarted: true })],
    ["a slot wait that gave up (no ffmpeg ran)", new Error("ffmpeg admission: waited too long")],
  ])("%s is rethrown, never completed without a preview", async (_label, err) => {
    m.probeJson = HEVC_10BIT
    m.previewFails = err
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toBeTruthy()
  })

  it("a failed upload of the preview is rethrown (a storage failure), not the fallback", async () => {
    m.probeJson = HEVC_10BIT
    m.previewUploadFails = true
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toThrow(/R2 PUT failed/)
  })

  it("the predicate: ffmpeg's own exit or time limit only", () => {
    expect(isPreviewEncodeFailure(Object.assign(new Error("exit 1"), { killed: false, timedOut: false }))).toBe(true)
    expect(isPreviewEncodeFailure(Object.assign(new Error("timeout"), { killed: true, timedOut: true }))).toBe(true)
    expect(isPreviewEncodeFailure(new Error("no flags"))).toBe(false)
  })
})

describe("what an original is kept for", () => {
  it("a file whose picture does not decode keeps no original: stored the old way, nothing recorded or charged", async () => {
    m.probeJson = HEVC_10BIT
    m.decodes = false
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.uploads.map((u) => u.id)).toEqual([JOB])
    expect(m.charges).toEqual([])
    // ...and when its preview makes no frame, the store fails (an unusable video): nothing kept.
    m.uploads.length = 0
    m.previewFails = Object.assign(new Error("[browser-safe-preview] the preview has no video frame"), { noVideoFrame: true })
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toThrow(/unusable-video/)
    expect(m.uploads).toEqual([])
    expect(m.charges).toEqual([])
  })

  it("a job that ended while its original was stored: the original is deleted, nothing charged, and the store stops as a cancel", async () => {
    m.probeJson = HEVC_10BIT
    m.outcome = "ended"
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toMatchObject({ name: "JobCancelledError" })
    expect(m.deleted).toEqual([`videos/${JOB}-master.mp4`])
    expect(m.charges).toEqual([])
    expect(m.preview).not.toHaveBeenCalled()
  })

  it("a duplicate finalizer whose completed job does not name that key: the object is deleted, and the store stores no original", async () => {
    m.probeJson = HEVC_10BIT
    m.outcome = "delivered"
    m.delivered = "unnamed"
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.deliveredDeleted).toEqual([`videos/${JOB}-master.mp4`])
    expect(m.charges).toEqual([])
  })

  it("a second finalizer of a job already completed: the delivered original at that key is never deleted, nothing charged", async () => {
    m.probeJson = HEVC_10BIT
    m.outcome = "delivered"
    const stored = await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)
    expect(stored.originalVideoUrl).toBe(`https://cdn.test/videos/${JOB}-master.mp4`)
    expect(m.deleted).toEqual([])
    expect(m.charges).toEqual([])
  })

  it("a store id naming another job than the running one keeps no original (nothing recorded on that row)", async () => {
    m.probeJson = HEVC_10BIT
    m.runningJob = "99999999-8888-4777-8666-555555555555"
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.charges).toEqual([])
    m.runningJob = JOB
    expect((await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).originalVideoUrl).toBe(`https://cdn.test/videos/${JOB}-master.mp4`)
  })

  it("a store id with no job of its own keeps no original", async () => {
    m.probeJson = HEVC_10BIT
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, { ...OPTS, jobId: "upscaled-abc" })).toEqual({ videoUrl: "https://cdn.test/videos/upscaled-abc.mp4" })
    expect(m.charges).toEqual([])
  })
})

describe("a check or encode the machine could not run never condemns a video (decided 2026-11-23)", () => {
  it("on the job's last attempt a check that could not run stores the file as before, so the job delivers its video", async () => {
    m.probeJson = HEVC_10BIT
    m.decodes = "unknown"
    m.finalAttempt = true
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.before).toHaveBeenCalled()
  })

  it("a probe the machine could not run (twice) is the same: retried, and stored as before on the last attempt", async () => {
    const oom = Object.assign(new Error("ffprobe failed: Cannot allocate memory"), { killed: false, timedOut: false })
    m.probes.push(oom, oom)
    const err = await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS).catch((e: unknown) => e)
    expect(err).not.toMatchObject({ name: "UnusableVideoError" })
    expect(isPostProcessingError(err)).toBe(true)
    m.probes.push(oom, oom)
    m.finalAttempt = true
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
  })

  it("a decode check that could not run: a retryable failure (post-processing), never an UnusableVideoError", async () => {
    m.probeJson = HEVC_10BIT
    m.decodes = "unknown"
    const err = await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS).catch((e: unknown) => e)
    expect(err).not.toMatchObject({ name: "UnusableVideoError" })
    expect(isPostProcessingError(err)).toBe(true)
    expect(m.uploads).toEqual([])
  })

  it.each([
    ["ffmpeg's own time limit", { killed: true, timedOut: true }],
    ["a launch that never started", { killed: false, timedOut: false, notStarted: true }],
    ["a kill from outside", { killed: false, timedOut: false, signalledFromOutside: true }],
    ["a frame count that could not run", { message: "[browser-safe-preview] the preview's frames could not be counted" }],
  ])("on a file that did not decode, %s is retried, not unusable", async (_label, flags) => {
    m.probeJson = HEVC_10BIT
    m.decodes = false
    m.previewFails = Object.assign(new Error("ffmpeg"), flags)
    const err = await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS).catch((e: unknown) => e)
    expect(err).not.toMatchObject({ name: "UnusableVideoError" })
    expect(isPostProcessingError(err)).toBe(true)
  })
})

describe("the box's failures are not the encode's", () => {
  it.each([
    ["an out-of-memory kill (SIGKILL from outside, killed false)", Object.assign(new Error("ffmpeg"), { killed: false, timedOut: false, signalledFromOutside: true })],
    ["a log that outgrew its capture buffer", Object.assign(new Error("maxBuffer"), { killed: true, timedOut: false, truncated: true })],
  ])("%s is rethrown on every attempt but the last, and on the last completes on the original", async (_label, err) => {
    expect(isPreviewEncodeFailure(err)).toBe(false)
    m.probeJson = HEVC_10BIT
    m.previewFails = err
    // The worker lane, not its last BullMQ attempt: retried.
    m.finalAttempt = false
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toMatchObject({ cause: err })
    // Its last attempt: the job completes on the decodable original.
    m.finalAttempt = true
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toMatchObject({ videoUrl: `https://cdn.test/videos/${JOB}-master.mp4`, videoPreviewUnavailable: true })
    // A reconcile lane (no job context): its last reconcile tick decides.
    m.finalAttempt = undefined
    await expect(storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).rejects.toMatchObject({ cause: err })
    m.reconcileLast = true
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toMatchObject({ videoPreviewUnavailable: true })
  })
})

describe("a delivered video we cannot use fails with its refund (decided 2026-11-23)", () => {
  it("an empty file: an UnusableVideoError (deterministic, so the job fails and is refunded now), never a post-processing failure", async () => {
    m.emptyFile = true
    const err = await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: "UnusableVideoError", deterministic: true })
    expect((err as Error).message).toMatch(/^unusable-video:/)
    expect(isPostProcessingError(err)).toBe(false)
  })

  it("a file whose picture does not decode and whose encode fails or makes no frame: the same", async () => {
    m.probeJson = HEVC_10BIT
    m.decodes = false
    m.previewFails = Object.assign(new Error("[browser-safe-preview] the preview has no video frame"), { noVideoFrame: true })
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS).catch((e: unknown) => e)).toMatchObject({ name: "UnusableVideoError" })
    m.previewFails = Object.assign(new Error("ffmpeg failed: [in#0] Invalid data found when processing input"), { killed: false, timedOut: false })
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS).catch((e: unknown) => e)).toMatchObject({ name: "UnusableVideoError" })
    // An exit code alone, or a failure that names the machine, is never the file's fault (a positive rule).
    for (const message of ["exit 69", "ffmpeg failed: Cannot allocate memory", "ffmpeg failed: No space left on device", "ffmpeg failed: Invalid data found when processing input: Cannot allocate memory"]) {
      m.previewFails = Object.assign(new Error(message), { killed: false, timedOut: false })
      expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS).catch((e: unknown) => e)).not.toMatchObject({ name: "UnusableVideoError" })
    }
  })

  it("the machine's failure on such a file stays the machine's (retried, not refunded as unusable)", async () => {
    m.probeJson = HEVC_10BIT
    m.decodes = false
    const oom = Object.assign(new Error("ffmpeg"), { killed: false, timedOut: false, signalledFromOutside: true })
    m.previewFails = oom
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS).catch((e: unknown) => e)).toMatchObject({ cause: oom })
  })
})

describe("an original exists only if its record lands (decided 2026-11-22)", () => {
  it("a record that does not land: the uploaded original is deleted and the file stored as before", async () => {
    m.probeJson = HEVC_10BIT
    m.outcome = "unrecorded"
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.deleted).toEqual([`videos/${JOB}-master.mp4`])
    expect(m.before).toHaveBeenCalled()
  })

  it("a record that cannot be told: no original named; discarded unless a record names it (never deleted outright)", async () => {
    m.probeJson = HEVC_10BIT
    m.outcome = "unknown"
    expect(await storeVideoResult({ url: "https://provider/v.mp4" }, OPTS)).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}.mp4` })
    expect(m.deleted).toEqual([])
    expect(m.neverRecordedDiscards).toEqual([`videos/${JOB}-master.mp4`])
  })
})

describe("storeVideoAsIs", () => {
  it("stores the file under the caller's container, nothing else", async () => {
    expect(await storeVideoAsIs({ url: "https://provider/v.mov" }, { jobId: `${JOB}-raw`, userId: "user-1", ext: "mov" })).toEqual({ videoUrl: `https://cdn.test/videos/${JOB}-raw.mov` })
    expect(m.uploads).toEqual([{ path: "<fetched>", id: `${JOB}-raw`, ext: "mov" }])
  })
})
