import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockUploadFileToR2 = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")

  // FFmpeg operation functions
  const mockCombineVideos = vi.fn().mockResolvedValue({ outputPath: "/tmp/combine-work/output.mp4" })
  const mockMergeVideoAudio = vi.fn().mockResolvedValue("/tmp/merge-work/output.mp4")
  const mockTrimAudio = vi.fn().mockResolvedValue({ audioPath: "/tmp/extract-work/audio.mp3" })
  const mockTrimVideo = vi.fn().mockResolvedValue({ videoPath: "/tmp/trim-work/output.mp4" })
  const mockResizeVideo = vi.fn().mockResolvedValue("/tmp/resize-work/output.mp4")
  const mockAdjustVolume = vi.fn().mockResolvedValue({ outputPath: "/tmp/volume-work/output.mp4", inputType: "video" as const })
  const mockAddCaptions = vi.fn().mockResolvedValue("/tmp/captions-work/output.mp4")
  const mockMixAudio = vi.fn().mockResolvedValue("/tmp/mix-work/output.mp3")
  const mockSpeedRamp = vi.fn().mockResolvedValue("/tmp/speed-work/output.mp4")
  const mockLoopVideo = vi.fn().mockResolvedValue({ outputPath: "/tmp/loop-work/output.mp4" })
  const mockFadeVideo = vi.fn().mockResolvedValue("/tmp/fade-work/output.mp4")
  const mockSmartLoopCut = vi.fn().mockResolvedValue({
    videoPath: "/tmp/slc-work/output.mp4", chosenFrameIndex: 184, psnr: 38, sourceFrameCount: 192, fps: 24,
  })

  // ffmpeg-utils
  const mockCreateWorkDir = vi.fn().mockResolvedValue("/tmp/transcode-work")
  const mockDownloadFile = vi.fn().mockResolvedValue(undefined)
  const mockRunFfmpeg = vi.fn().mockResolvedValue(undefined)
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  const BROWSER_SAFE_VIDEO_ARGS = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23", "-movflags", "+faststart"]
  const mockProbeVideoSource = vi.fn().mockResolvedValue({ width: 1080, height: 1920, durationSeconds: 5 })

  // render queue (kinetic captions hand the job off here)
  const mockRenderQueueAdd = vi.fn().mockResolvedValue(undefined)

  // Transcription — the local provider and the cloud replay ladder (#761).
  const mockTranscribe = vi.fn().mockResolvedValue({ text: "hi", words: [{ text: "hi", startMs: 0, endMs: 900 }] })
  const mockShouldRunOnCloud = vi.fn().mockResolvedValue(false)
  const mockRunJobOnCloud = vi.fn().mockResolvedValue({ text: "hi", words: [{ text: "hi", startMs: 0, endMs: 900 }] })

  // Shared helpers
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
  const mockCompleteFfmpegVideoJob = vi.fn().mockResolvedValue(undefined)
  const mockCompleteFfmpegAudioJob = vi.fn().mockResolvedValue(undefined)

  // fs.promises.rm
  const mockFsRm = vi.fn().mockResolvedValue(undefined)

  // Supabase chain
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockUploadFileToR2,
    mockTranscribe,
    mockShouldRunOnCloud,
    mockRunJobOnCloud,
    mockCombineVideos,
    mockMergeVideoAudio,
    mockTrimAudio,
    mockTrimVideo,
    mockResizeVideo,
    mockAdjustVolume,
    mockAddCaptions,
    mockMixAudio,
    mockSpeedRamp,
    mockLoopVideo,
    mockFadeVideo,
    mockSmartLoopCut,
    mockCreateWorkDir,
    mockDownloadFile,
    mockRunFfmpeg,
    mockCleanupWorkDir,
    BROWSER_SAFE_VIDEO_ARGS,
    mockProbeVideoSource,
    mockRenderQueueAdd,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockGenerateAndUploadThumbnail,
    mockCompleteFfmpegVideoJob,
    mockCompleteFfmpegAudioJob,
    mockFsRm,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("node:fs", () => ({
  promises: { rm: mocks.mockFsRm },
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/lib/storage.js", () => ({
  mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}`,
  uploadFileToR2: mocks.mockUploadFileToR2,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: mocks.mockCreateWorkDir,
  downloadFile: mocks.mockDownloadFile,
  runFfmpeg: mocks.mockRunFfmpeg,
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  probeVideoSource: mocks.mockProbeVideoSource,
  BROWSER_SAFE_VIDEO_ARGS: mocks.BROWSER_SAFE_VIDEO_ARGS,
  // Real values (re-exported from the pure `ffmpeg-timeouts.ts`; apply-edl's
  // liveness budget reads that leaf directly, so this mock cannot skew it).
  DEFAULT_FFMPEG_TIMEOUT_MS: 10 * 60 * 1000,
  DOWNLOAD_TIMEOUT_MS: 120_000,
  FFPROBE_TIMEOUT_MS: 120_000,
}))

vi.mock("@/providers/audio/transcribe.js", () => ({
  transcribe: mocks.mockTranscribe,
}))

vi.mock("@/providers/nodaro/run-on-cloud.js", () => ({
  shouldRunOnCloud: mocks.mockShouldRunOnCloud,
  runJobOnCloud: mocks.mockRunJobOnCloud,
}))

vi.mock("@/lib/render-queue.js", () => ({
  renderQueue: { add: mocks.mockRenderQueueAdd },
}))

vi.mock("@/providers/video/combine-videos.js", () => ({
  combineVideos: mocks.mockCombineVideos,
}))

vi.mock("@/providers/video/merge-video-audio.js", () => ({
  mergeVideoAudio: mocks.mockMergeVideoAudio,
}))

vi.mock("@/providers/video/trim-audio.js", () => ({
  trimAudio: mocks.mockTrimAudio,
}))

vi.mock("@/providers/video/trim-video.js", () => ({
  trimVideo: mocks.mockTrimVideo,
}))

vi.mock("@/providers/video/smart-loop-cut.js", () => ({
  smartLoopCut: mocks.mockSmartLoopCut,
}))

vi.mock("@/providers/video/resize-video.js", () => ({
  resizeVideo: mocks.mockResizeVideo,
}))

vi.mock("@/providers/video/adjust-volume.js", () => ({
  adjustVolume: mocks.mockAdjustVolume,
}))

vi.mock("@/providers/video/add-captions.js", () => ({
  addCaptions: mocks.mockAddCaptions,
}))

vi.mock("@/providers/video/mix-audio.js", () => ({
  mixAudio: mocks.mockMixAudio,
}))

vi.mock("@/providers/video/speed-ramp.js", () => ({
  speedRamp: mocks.mockSpeedRamp,
}))

vi.mock("@/providers/video/loop-video.js", () => ({
  loopVideo: mocks.mockLoopVideo,
}))

vi.mock("@/providers/video/fade-video.js", () => ({
  fadeVideo: mocks.mockFadeVideo,
}))

vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  markJobCompleted: mocks.mockMarkJobCompleted,
  generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
  completeFfmpegVideoJob: mocks.mockCompleteFfmpegVideoJob,
  completeFfmpegAudioJob: mocks.mockCompleteFfmpegAudioJob,
  // setJobProgress writes progress to BOTH BullMQ + the jobs.progress
  // DB column. Tests don't care about the side-effects, so a no-op
  // mock is fine.
  setJobProgress: vi.fn(async () => {}),
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { ffmpegHandlers } from "../ffmpeg.js"
import { applyEdlRenderBudgetMs } from "@/providers/video/apply-edl.js"
import { BUDGETED_JOB_NAMES, declaredJobBudgetMs } from "@/lib/job-budget.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return {
    name,
    data: { jobId: "job-1", ...data },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobUserId: "user-1",
    usageLogId: "usage-1",
    shouldWatermark: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockUploadFileToR2.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
  mocks.mockTrimAudio.mockResolvedValue({ audioPath: "/tmp/extract-work/audio.mp3" })
  mocks.mockAdjustVolume.mockResolvedValue({ outputPath: "/tmp/volume-work/output.mp4", inputType: "video" as const })
})

// ---------------------------------------------------------------------------
// add-captions — kinetic render handoff (reconcile sentinel)
// ---------------------------------------------------------------------------

describe("add-captions handler — kinetic render handoff", () => {
  const handler = ffmpegHandlers["add-captions"]

  it("clears the pre-task reconcile sentinel BEFORE handing off to the render queue", async () => {
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "karaoke", // kinetic style → dispatchKineticCaptions
      captions: [{ text: "hi", startMs: 0, endMs: 1000 }], // provided → no transcribe
    })
    await handler(job as never, makeCtx())

    // The video-worker stamped provider_kind="pre-task" + provider_call_started_at
    // before this handler ran. The kinetic path hands the job to the render queue
    // (no onTaskCreated), so the sentinel MUST be cleared here — otherwise the
    // reconcile cron fails+refunds the still-rendering job at the 30-min threshold.
    expect(mocks.mockUpdate).toHaveBeenCalledWith({
      provider_kind: null,
      provider_call_started_at: null,
    })

    // Hands off to the render queue with a deterministic jobId so a worker
    // stall-retry coalesces onto the same render instead of duplicating it.
    expect(mocks.mockRenderQueueAdd).toHaveBeenCalledTimes(1)
    const [name, , opts] = mocks.mockRenderQueueAdd.mock.calls[0]
    expect(name).toBe("render")
    expect(opts).toEqual({ jobId: "render-job-1" })

    // Ordering matters — the render job could be picked up immediately, so the
    // sentinel-clear must land before the handoff.
    expect(mocks.mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mockRenderQueueAdd.mock.invocationCallOrder[0],
    )
  })
})

/**
 * THE KEYLESS SELF-HOST (F8). `add-captions` is on a customer deployment's
 * node allowlist, and its kinetic styles auto-transcribe by default — but the
 * kinetic path called the transcribe PROVIDER directly, so on a deployment
 * with no REPLICATE_API_TOKEN / ELEVENLABS_API_KEY (the target configuration)
 * a whitelisted node could not run at all. `transcribe` IS in
 * CLOUD_ROUTE_BY_JOB_TYPE, and handleTranscribe already uses the ladder.
 */
describe("add-captions handler — the kinetic transcribe ladder", () => {
  const handler = ffmpegHandlers["add-captions"]

  const kineticJob = () =>
    makeJob("add-captions", { videoUrl: "https://v.mp4", style: "karaoke" })

  it("replays transcription on the cloud when this install holds no key", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(true)

    await handler(kineticJob() as never, makeCtx())

    expect(mocks.mockRunJobOnCloud).toHaveBeenCalledTimes(1)
    const [jobType, payload] = mocks.mockRunJobOnCloud.mock.calls[0]
    expect(jobType).toBe("transcribe")
    // `audioUrl` matches URL_FIELD so run-on-cloud re-hosts a local-MinIO
    // videoUrl before the POST; `jobId` is in INSTANCE_ONLY_FIELDS, stripped
    // from the wire body but used to stamp relay_job_id/relay_credits.
    expect(payload).toMatchObject({
      jobId: "job-1",
      audioUrl: "https://v.mp4",
      // The local default (`incredibly-fast-whisper`) relayed VERBATIM, because
      // the cloud's /v1/transcribe enum accepts it again. The substitution lane
      // (TRANSCRIBE_PROVIDERS ∩ "can do word timestamps") only kicks in for a
      // local choice the cloud would reject — relaying one of those was a
      // guaranteed 400 while the Replicate lanes were hidden from the enum.
      provider: "incredibly-fast-whisper",
      wordTimestamps: true,
    })
    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
    expect(mocks.mockRenderQueueAdd).toHaveBeenCalledTimes(1)
  })

  it("relays a lane the cloud's enum ACCEPTS verbatim — the substitution is only for rejected ones", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(true)
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "karaoke",
      transcribe_provider: "elevenlabs-stt",
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockRunJobOnCloud.mock.calls[0][1]).toMatchObject({ provider: "elevenlabs-stt" })
  })

  it("SKIPS transcription entirely on a lane that cannot return word timings, and renders the text", async () => {
    // `transcribe()` refuses this pair before the provider call, so calling it
    // would fail the job — including this case, where `text` was always the
    // documented fallback. Skip the vendor call and let the text/no-source
    // ladder decide: the render goes ahead with synthetic captions.
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "karaoke",
      transcribe_provider: "whisper",
      text: "hello world",
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
    expect(mocks.mockRunJobOnCloud).not.toHaveBeenCalled()
    // The lane is decided before the cloud ladder, so the connection is never
    // consulted for a render it could not help with.
    expect(mocks.mockShouldRunOnCloud).not.toHaveBeenCalled()
    expect(mocks.mockRenderQueueAdd).toHaveBeenCalledTimes(1)
  })

  it("still fails honestly when the incapable lane is the ONLY caption source", async () => {
    // Nothing to fall back to — the existing "no words and no text" error is the
    // right outcome, and the route rejects this combination at ingress anyway.
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "karaoke",
      transcribe_provider: "whisper",
    })

    await expect(handler(job as never, makeCtx())).rejects.toThrow(/no words and no text fallback/)
    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
  })

  it("is byte-identical on a keyed install — the local provider, no cloud call", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)

    await handler(kineticJob() as never, makeCtx())

    expect(mocks.mockTranscribe).toHaveBeenCalledTimes(1)
    expect(mocks.mockRunJobOnCloud).not.toHaveBeenCalled()
  })

  it("fails loudly on a version-skewed cloud that returns no words array", async () => {
    // The suno-lyrics rule: validate rather than trust. Without this the empty
    // payload falls through to the synthetic-text branch and the job completes
    // with captions nobody asked for, or dies with a misleading message.
    mocks.mockShouldRunOnCloud.mockResolvedValue(true)
    mocks.mockRunJobOnCloud.mockResolvedValue({ text: "hi" })

    await expect(handler(kineticJob() as never, makeCtx())).rejects.toThrow(
      /nodaro\.ai returned no transcription/,
    )
  })

  it("asks the cloud nothing when captions are supplied", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(true)
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "karaoke",
      captions: [{ text: "hi", startMs: 0, endMs: 1000 }],
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockShouldRunOnCloud).not.toHaveBeenCalled()
    expect(mocks.mockRunJobOnCloud).not.toHaveBeenCalled()
    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
  })
})

/**
 * A SUBTITLE does not need word timings. It draws whole lines and the Remotion
 * SubtitleOverlay groups/holds them itself, so the phrase segments EVERY lane
 * returns are enough. Before this, `subtitle` + `whisper` + no `text` reserved
 * credits, skipped the transcription as if the lane were useless, and then died
 * with "transcribe returned no words" — a refund for a render that was always
 * servable.
 */
describe("add-captions handler — phrase-level transcription for a subtitle", () => {
  const handler = ffmpegHandlers["add-captions"]

  /** A subtitle that routes to Remotion (a styling lever) and auto-transcribes. */
  const subtitleJob = (extra: Record<string, unknown> = {}) =>
    makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "subtitle",
      uppercase: true,
      transcribe_provider: "whisper",
      ...extra,
    })

  const planOf = () => mocks.mockRenderQueueAdd.mock.calls[0][1].plan as Record<string, unknown>

  it("RUNS the word-less lane without asking for word timings, and captions its segments", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    mocks.mockTranscribe.mockResolvedValueOnce({
      text: "one two. three four.",
      segments: [
        { start: 0, end: 1.5, text: "one two." },
        { start: 1.5, end: 3, text: "three four." },
      ],
    })

    await handler(subtitleJob() as never, makeCtx())

    expect(mocks.mockTranscribe).toHaveBeenCalledTimes(1)
    expect(mocks.mockTranscribe.mock.calls[0][1]).toBe("whisper")
    expect(mocks.mockTranscribe.mock.calls[0][3]).toMatchObject({ wordTimestamps: false })
    expect(planOf().captions).toEqual([
      { text: "one two.", startMs: 0, endMs: 1500, timestampMs: 0, confidence: null },
      { text: " three four.", startMs: 1500, endMs: 3000, timestampMs: 1500, confidence: null },
    ])
  })

  it("a CAPABLE lane is still asked for word timings on a subtitle (words are the better input)", async () => {
    // The line overlays group words into lines themselves, and `maxWordsPerLine`
    // counts WORDS — asking the default auto-transcribe lane for chunks instead
    // would silently coarsen every subtitle and break that lever. Only a lane
    // that cannot give words drops to phrase segments.
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "subtitle",
      uppercase: true,
      maxWordsPerLine: 3,
      // no transcribe_provider → the worker's own default, incredibly-fast-whisper
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockTranscribe.mock.calls[0][1]).toBe("incredibly-fast-whisper")
    expect(mocks.mockTranscribe.mock.calls[0][3]).toMatchObject({ wordTimestamps: true })
  })

  it("relays a CAPABLE lane WITH the flag even for a subtitle", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(true)
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({
      text: "hi",
      words: [{ text: "hi", startMs: 0, endMs: 400 }],
    })

    await handler(subtitleJob({ transcribe_provider: "elevenlabs-stt" }) as never, makeCtx())

    expect(mocks.mockRunJobOnCloud.mock.calls[0][1]).toMatchObject({
      provider: "elevenlabs-stt",
      wordTimestamps: true,
    })
  })

  it("prefers the words when the lane returns them anyway (elevenlabs is always word-level)", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    mocks.mockTranscribe.mockResolvedValueOnce({
      text: "hi there",
      words: [{ text: "hi", startMs: 0, endMs: 400 }],
      segments: [{ start: 0, end: 1, text: "hi there" }],
    })

    await handler(subtitleJob({ transcribe_provider: "elevenlabs-stt" }) as never, makeCtx())

    expect(planOf().captions).toEqual([{ text: "hi", startMs: 0, endMs: 400 }])
  })

  it("relays WITHOUT the word-timings flag, and accepts a segments-only cloud answer", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(true)
    mocks.mockRunJobOnCloud.mockResolvedValueOnce({
      text: "hello",
      segments: [{ start: 0, end: 2, text: "hello" }],
    })

    await handler(subtitleJob() as never, makeCtx())

    const payload = mocks.mockRunJobOnCloud.mock.calls[0][1]
    expect(payload).not.toHaveProperty("wordTimestamps")
    expect(planOf().captions).toEqual([
      { text: "hello", startMs: 0, endMs: 2000, timestampMs: 0, confidence: null },
    ])
  })

  it("a KINETIC style still skips the word-less lane (it cannot serve that render)", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "karaoke",
      transcribe_provider: "whisper",
      text: "hello world",
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
  })

  it("still fails honestly when the lane returns no speech and there is no text", async () => {
    mocks.mockShouldRunOnCloud.mockResolvedValue(false)
    mocks.mockTranscribe.mockResolvedValueOnce({ text: "", segments: [] })

    await expect(handler(subtitleJob() as never, makeCtx())).rejects.toThrow(
      /no speech and no text fallback/,
    )
  })
})

/**
 * S1 — `text` on a `subtitle` IS the caption. #1536 routed a subtitle carrying a
 * styling lever to Remotion, where `needTranscribe` never consulted `text`: the
 * caller's words were silently replaced by a transcription of the audio (and a
 * transcription failure failed the job despite the text being right there).
 */
describe("add-captions handler — a subtitle's `text` is the caption, not a fallback", () => {
  const handler = ffmpegHandlers["add-captions"]

  const planOf = () => mocks.mockRenderQueueAdd.mock.calls[0][1].plan as {
    captions: Array<Record<string, unknown>>
    maxWordsPerLine?: number
    durationInFrames: number
  }

  /** A 12 s source, so a caption spanning the video is distinguishable from the
   *  5 s "duration unknown" fallback. */
  const probe12s = () =>
    mocks.mockProbeVideoSource.mockResolvedValueOnce({ width: 1080, height: 1920, durationSeconds: 12 })

  it("burns the text as ONE block spanning the clip, with NO vendor call", async () => {
    probe12s()
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "subtitle",
      text: "SALE ENDS\nFRIDAY",
      positionY: 65, // a styling lever → this render is Remotion, billed :kinetic
    })

    await handler(job as never, makeCtx())

    // No transcription: not locally, and not relayed to the cloud either.
    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
    expect(mocks.mockRunJobOnCloud).not.toHaveBeenCalled()
    // Exactly one caption, the caller's own text, spanning the whole video.
    expect(planOf().captions).toEqual([
      { text: "SALE ENDS\nFRIDAY", startMs: 0, endMs: 12000, timestampMs: 0, confidence: null },
    ])
    expect(planOf().durationInFrames).toBe(360) // 12 s at the fallback 30 fps
  })

  it("does not transcribe even when auto_transcribe is explicitly true", async () => {
    probe12s()
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "subtitle",
      text: "STILL MY TEXT",
      uppercase: true,
      auto_transcribe: true,
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
    expect(planOf().captions).toHaveLength(1)
    expect(planOf().captions[0]!.text).toBe("STILL MY TEXT")
  })

  it("maxWordsPerLine re-wraps the block itself and NEVER reaches the render plan", async () => {
    // The overlay time-splits a capped entry into pages; a static block must stay
    // one block, so the cap is applied to the TEXT here and withheld from the plan.
    probe12s()
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "subtitle",
      text: "one two three four five",
      maxWordsPerLine: 2,
    })

    await handler(job as never, makeCtx())

    expect(mocks.mockTranscribe).not.toHaveBeenCalled()
    expect(planOf().captions).toHaveLength(1)
    expect(planOf().captions[0]!.text).toBe("one two\nthree four\nfive")
    expect(planOf().maxWordsPerLine).toBeUndefined()
  })

  it("a KINETIC style keeps `text` as the evenly-timed FALLBACK (unchanged), cap and all", async () => {
    probe12s()
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "word-pop",
      text: "one two three",
      maxWordsPerLine: 2,
      transcribe_provider: "whisper", // word-less lane → skipped, text carries the render
    })

    await handler(job as never, makeCtx())

    expect(planOf().captions.map((c) => c.text)).toEqual(["one", " two", " three"])
    expect(planOf().maxWordsPerLine).toBe(2)
  })

  it("a transcript still WINS over text on a subtitle (precedence unchanged)", async () => {
    probe12s()
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "subtitle",
      text: "ignored",
      transcript: { version: 1, words: [{ text: "real", startMs: 0, endMs: 400 }] },
    })

    await handler(job as never, makeCtx())

    expect(planOf().captions.map((c) => c.text)).toEqual(["real"])
  })
})

/**
 * OUTPUT FPS = SOURCE FPS. Burning captions re-encodes the clip through
 * Remotion, so a hardcoded 30 re-timed every 24 fps source (judder + a duration
 * that no longer matches the input). render-worker renders at `plan.fps`, so
 * the plan is where the source's rate has to land.
 */
describe("add-captions handler — the render follows the source frame rate", () => {
  const handler = ffmpegHandlers["add-captions"]

  const probe = (fps?: number) =>
    mocks.mockProbeVideoSource.mockResolvedValueOnce({
      width: 1080,
      height: 1920,
      durationSeconds: 5,
      ...(fps !== undefined ? { fps } : {}),
    })

  const kineticJob = () =>
    makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "karaoke",
      captions: [{ text: "hi", startMs: 0, endMs: 1000 }],
    })

  const planOf = () => mocks.mockRenderQueueAdd.mock.calls[0][1].plan as { fps: number; durationInFrames: number }

  it("renders a 24 fps source at 24, and counts frames at that rate", async () => {
    probe(24)
    await handler(kineticJob() as never, makeCtx())
    // 5s of video (longer than the 1s of captions) at 24 fps.
    expect(planOf()).toMatchObject({ fps: 24, durationInFrames: 120 })
  })

  it("rounds a fractional rate (23.976 → 24)", async () => {
    probe(24000 / 1001)
    await handler(kineticJob() as never, makeCtx())
    expect(planOf().fps).toBe(24)
  })

  it("clamps to the plan's accepted band instead of failing validation after the job is paid for", async () => {
    probe(120)
    await handler(kineticJob() as never, makeCtx())
    expect(planOf().fps).toBe(60)

    mocks.mockRenderQueueAdd.mockClear()
    probe(8)
    await handler(kineticJob() as never, makeCtx())
    expect(planOf().fps).toBe(15)
  })

  it("keeps 30 when the container reports no usable rate", async () => {
    probe(undefined)
    await handler(kineticJob() as never, makeCtx())
    expect(planOf()).toMatchObject({ fps: 30, durationInFrames: 150 })
  })

  it("keeps 30 when the probe itself failed", async () => {
    mocks.mockProbeVideoSource.mockRejectedValueOnce(new Error("ffprobe failed"))
    await handler(kineticJob() as never, makeCtx())
    // No duration either — the plan falls back to the captions' own span.
    expect(planOf().fps).toBe(30)
  })

  // S6's second fallback: the plan's frame budget is checked at plan validation,
  // which is AFTER credits are reserved (and after any paid transcription), so a
  // clip long enough to blow it renders at the historical 30 instead.
  it("falls back to 30 when duration x source fps would exceed the plan's frame cap", async () => {
    mocks.mockProbeVideoSource.mockResolvedValueOnce({ width: 1080, height: 1920, durationSeconds: 1860, fps: 60 })
    await handler(kineticJob() as never, makeCtx())
    // 31 min at 60 fps = 111,600 frames, past the cap; at 30 it is 55,800.
    expect(planOf()).toMatchObject({ fps: 30, durationInFrames: 55800 })
  })

  it("keeps 60 for a long clip that still FITS the cap", async () => {
    mocks.mockProbeVideoSource.mockResolvedValueOnce({ width: 1080, height: 1920, durationSeconds: 1700, fps: 60 })
    await handler(kineticJob() as never, makeCtx())
    expect(planOf()).toMatchObject({ fps: 60, durationInFrames: 102000 })
  })
})

describe("add-captions handler — maxWordsPerLine reaches the render plan", () => {
  const handler = ffmpegHandlers["add-captions"]

  it("carries the top-level cap, and a segment inherits it", async () => {
    const job = makeJob("add-captions", {
      videoUrl: "https://v.mp4",
      style: "word-highlight",
      captions: [{ text: "hi", startMs: 0, endMs: 1000 }],
      maxWordsPerLine: 3,
      segments: [{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 2000, maxWordsPerLine: 5 }],
    })

    await handler(job as never, makeCtx())

    const plan = mocks.mockRenderQueueAdd.mock.calls[0][1].plan as {
      maxWordsPerLine?: number
      segments?: Array<{ maxWordsPerLine?: number }>
    }
    expect(plan.maxWordsPerLine).toBe(3)
    expect(plan.segments?.map((s) => s.maxWordsPerLine)).toEqual([3, 5])
  })
})

// ---------------------------------------------------------------------------
// apply-edl — liveness budget
// ---------------------------------------------------------------------------

// The pre-task heartbeat's default cap is the orchestrator's 90-min node
// ceiling; a final-quality apply-edl render of a long episode outlives it, and
// on a direct lane nothing else bounds the run. The handler declares its own
// liveness budget — the sum of the kill budgets of its bounded steps, the
// per-chunk ffmpeg budget being the SAME one the render gives itself — so
// "hung" means one thing to the heartbeat and to those steps. (Storage I/O
// and slot waits have no ceiling to add; they are the stated residual.)
describe("apply-edl handler liveness budget", () => {
  const edl = {
    version: 1, clock: "master",
    sources: [{ id: "A", url: "https://f.test/a.mp4", kind: "video" }],
    segments: Array.from({ length: 180 }, (_, i) => ({ id: `s${i}`, inMs: i * 60_000, outMs: (i + 1) * 60_000, video: "A" })),
  }

  it("declares applyEdlRenderBudgetMs(edl) for the job's own EDL — well past the 90-minute default cap", () => {
    const budget = ffmpegHandlers["apply-edl"]!.livenessBudgetMs!(makeJob("apply-edl", { edl }) as never)
    expect(budget).toBe(applyEdlRenderBudgetMs(edl as never))
    expect(budget!).toBeGreaterThan(90 * 60_000)
  })

  it("declares nothing (keeps the default cap) when the payload carries no EDL", () => {
    expect(ffmpegHandlers["apply-edl"]!.livenessBudgetMs!(makeJob("apply-edl", {}) as never)).toBeUndefined()
  })

  it("is the only ffmpeg handler that DECLARES a liveness budget (the others fit the default cap)", () => {
    const declaring = Object.entries(ffmpegHandlers).filter(([, h]) => typeof h.livenessBudgetMs === "function").map(([k]) => k)
    expect(declaring).toEqual(["apply-edl"])
  })
})

// Podcast Track 0.11: the workflow orchestrator sizes an apply-edl node's
// processing/poll ceilings (and the workflow's cap) from `declaredJobBudgetMs`
// — the job-budget registry. The heartbeat beats for the handler's
// `livenessBudgetMs`. If the two ever read the same job differently, the DAG
// would cancel a render its worker still reports live (or wait on a hung one).
// So: every handler that declares a budget must return EXACTLY the registry's
// number for the same payload — including the payloads the DAG actually sends
// (`jobId`, `usageLogId`, `quality`, `transcript` beside `edl` / `output`) and
// the ones it cannot read — and every registered job name must be declared by
// its handler (all budgeted job types are ffmpeg handlers today; a budgeted
// type living in another handler map must be added to this check).
describe("handler liveness budget ⇔ job-budget registry (the orchestrator's number)", () => {
  const edl = (minutes: number, extra: Record<string, unknown> = {}) => ({
    version: 1, clock: "master",
    sources: [
      { id: "A", url: "https://f.test/a.mp4", kind: "video" },
      { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio", role: "master-audio" },
    ],
    segments: Array.from({ length: minutes }, (_, i) => ({ id: `s${i}`, inMs: i * 60_000, outMs: (i + 1) * 60_000, video: "A" })),
    ...extra,
  })
  const payloads: Array<Record<string, unknown>> = [
    { edl: edl(180), output: "video", quality: "final", usageLogId: "u-1", transcript: "{}" },
    { edl: edl(180), output: "audio", quality: "final" },
    { edl: edl(45), quality: "proxy" },
    { edl: edl(300), output: "bogus" },
    { edl: { segments: "nope" } },
    {},
  ]

  it("every declaring handler returns the registry's budget for the same payload", () => {
    const declaring = Object.entries(ffmpegHandlers).filter(([, h]) => typeof h.livenessBudgetMs === "function")
    expect(declaring.length).toBeGreaterThan(0)
    for (const [name, handler] of declaring) {
      for (const data of payloads) {
        const job = makeJob(name, data)
        expect(handler.livenessBudgetMs!(job as never), `${name} ${JSON.stringify(Object.keys(data))}`)
          .toBe(declaredJobBudgetMs(name, job.data))
      }
    }
  })

  it("every registered job name is declared by its handler (no budget the heartbeat would not beat for)", () => {
    for (const name of BUDGETED_JOB_NAMES) {
      expect(typeof ffmpegHandlers[name]?.livenessBudgetMs, name).toBe("function")
    }
  })
})

describe("combine-videos handler", () => {
  const handler = ffmpegHandlers["combine-videos"]

  it("happy path: combines, uploads, cleans up with fs.rm, saves to DB", async () => {
    const job = makeJob("combine-videos", {
      videoUrls: ["https://a.mp4", "https://b.mp4"],
      transition: "fade",
      transitionDuration: 1,
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockCombineVideos).toHaveBeenCalledWith({
      videoUrls: ["https://a.mp4", "https://b.mp4"],
      transition: "fade",
      transitionDuration: 1,
      audioMode: "crossfade",
      trimStartFrames: 0,
      trimEndFrames: 0,
    })
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/combine-work/output.mp4", "job-1", "video", "user-1")
    // Uses fs.rm, not cleanupWorkDir
    expect(mocks.mockFsRm).toHaveBeenCalledWith("/tmp/combine-work", { recursive: true, force: true })
    expect(mocks.mockCleanupWorkDir).not.toHaveBeenCalled()
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("defaults audioMode to 'crossfade' when not specified", async () => {
    const job = makeJob("combine-videos", {
      videoUrls: ["https://a.mp4"],
      transition: "cut",
      transitionDuration: 0,
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockCombineVideos).toHaveBeenCalledWith(
      expect.objectContaining({ audioMode: "crossfade" }),
    )
  })

  it("uses provided audioMode", async () => {
    const job = makeJob("combine-videos", {
      videoUrls: ["https://a.mp4"],
      transition: "cut",
      transitionDuration: 0,
      audioMode: "remove",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockCombineVideos).toHaveBeenCalledWith(
      expect.objectContaining({ audioMode: "remove" }),
    )
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("combine-videos", {
      videoUrls: ["https://a.mp4"],
      transition: "cut",
      transitionDuration: 0,
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// merge-video-audio
// ---------------------------------------------------------------------------

describe("merge-video-audio handler", () => {
  const handler = ffmpegHandlers["merge-video-audio"]

  it("delegates to mergeVideoAudio then completeFfmpegVideoJob", async () => {
    const job = makeJob("merge-video-audio", {
      videoUrl: "https://vid.mp4",
      audioUrl: "https://audio.mp3",
      voiceoverVolume: 80,
      backgroundVolume: 20,
      keepOriginalAudio: true,
    })
    const ctx = makeCtx()
    await handler(job as never, ctx)

    expect(mocks.mockMergeVideoAudio).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4",
      audioUrl: "https://audio.mp3",
      audioTracks: undefined,
      voiceoverVolume: 80,
      backgroundVolume: 20,
      keepOriginalAudio: true,
    })
    expect(mocks.mockCompleteFfmpegVideoJob).toHaveBeenCalledWith("/tmp/merge-work/output.mp4", ctx)
  })
})

// ---------------------------------------------------------------------------
// trim-audio
// ---------------------------------------------------------------------------

describe("trim-audio handler", () => {
  const handler = ffmpegHandlers["trim-audio"]

  it("trims audio and uploads without silent video", async () => {
    const job = makeJob("trim-audio", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockTrimAudio).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4",
      audioFormat: undefined,
      startTime: undefined,
      endTime: undefined,
    })
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/extract-work/audio.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith("/tmp/extract-work")
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("passes startTime and endTime to trimAudio", async () => {
    const job = makeJob("trim-audio", { videoUrl: "https://vid.mp4", startTime: 5, endTime: 15 })
    await handler(job as never, makeCtx())

    expect(mocks.mockTrimAudio).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4",
      audioFormat: undefined,
      startTime: 5,
      endTime: 15,
    })
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledTimes(1)
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/extract-work/audio.mp3", "job-1", "audio", "user-1")
  })

  it("stores only audioUrl in output_data", async () => {
    mocks.mockUploadFileToR2.mockResolvedValueOnce("https://r2.example.com/audio.mp3")

    const job = makeJob("trim-audio", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
        output_data: {
          audioUrl: "https://r2.example.com/audio.mp3",
        },
      }),
    )
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("trim-audio", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// trim-video
// ---------------------------------------------------------------------------

describe("trim-video handler", () => {
  const handler = ffmpegHandlers["trim-video"]

  it("trims video, uploads, generates thumbnail, saves to DB", async () => {
    mocks.mockTrimVideo.mockResolvedValueOnce({ videoPath: "/tmp/trim-work/output.mp4" })
    const job = makeJob("trim-video", { videoUrl: "https://vid.mp4", startTime: 5, endTime: 15 })
    const ctx = makeCtx()
    await handler(job as never, ctx)

    expect(mocks.mockTrimVideo).toHaveBeenCalledWith({ videoUrl: "https://vid.mp4", startTime: 5, endTime: 15, outputSilentVideo: undefined })
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/trim-work/output.mp4", "job-1", "video", "user-1")
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("forwards outputSilentVideo=true to the provider (single-output, no sidecar upload)", async () => {
    mocks.mockUploadFileToR2.mockResolvedValueOnce("https://r2.example.com/video.mp4")

    const job = makeJob("trim-video", { videoUrl: "https://vid.mp4", startTime: 5, endTime: 15, outputSilentVideo: true })
    await handler(job as never, makeCtx())

    expect(mocks.mockTrimVideo).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4", startTime: 5, endTime: 15, outputSilentVideo: true,
    })
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledTimes(1)
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/trim-work/output.mp4", "job-1", "video", "user-1")
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: expect.objectContaining({ videoUrl: "https://r2.example.com/video.mp4" }),
    }))
  })

  it("forwards outputSilentVideo=true through the smart-loop-cut path", async () => {
    mocks.mockSmartLoopCut.mockResolvedValueOnce({
      videoPath: "/tmp/slc-work/output.mp4",
      chosenFrameIndex: 184,
      psnr: 38.2,
      sourceFrameCount: 192,
      fps: 24,
    })
    mocks.mockUploadFileToR2.mockResolvedValueOnce("https://r2.example.com/video.mp4")

    const job = makeJob("trim-video", {
      videoUrl: "https://vid.mp4",
      smartLoopCut: true,
      smartLoopCutLookback: 32,
      outputSilentVideo: true,
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockSmartLoopCut).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4",
      lookbackFrames: 32,
      outputSilent: true,
    })
  })
})

// ---------------------------------------------------------------------------
// speed-ramp
// ---------------------------------------------------------------------------

describe("speed-ramp handler", () => {
  const handler = ffmpegHandlers["speed-ramp"]

  it("delegates to speedRamp then completeFfmpegVideoJob", async () => {
    const job = makeJob("speed-ramp", { videoUrl: "https://vid.mp4", speed: 2, adjustAudio: true })
    const ctx = makeCtx()
    await handler(job as never, ctx)

    expect(mocks.mockSpeedRamp).toHaveBeenCalledWith({ videoUrl: "https://vid.mp4", speed: 2, adjustAudio: true })
    expect(mocks.mockCompleteFfmpegVideoJob).toHaveBeenCalledWith("/tmp/speed-work/output.mp4", ctx)
  })
})

// ---------------------------------------------------------------------------
// loop-video
// ---------------------------------------------------------------------------

describe("loop-video handler", () => {
  const handler = ffmpegHandlers["loop-video"]

  it("delegates to loopVideo then completeFfmpegVideoJob", async () => {
    const job = makeJob("loop-video", { videoUrl: "https://vid.mp4", mode: "repeat", repeatCount: 3 })
    const ctx = makeCtx()
    await handler(job as never, ctx)

    expect(mocks.mockLoopVideo).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4",
      mode: "repeat",
      repeatCount: 3,
      targetDuration: undefined,
      smartLoopCutBeforeRepeat: undefined,
      smartLoopCutLookback: undefined,
    })
    expect(mocks.mockCompleteFfmpegVideoJob).toHaveBeenCalledWith("/tmp/loop-work/output.mp4", ctx, undefined)
  })
})

// ---------------------------------------------------------------------------
// fade-video
// ---------------------------------------------------------------------------

describe("fade-video handler", () => {
  const handler = ffmpegHandlers["fade-video"]

  it("delegates to fadeVideo then completeFfmpegVideoJob", async () => {
    const job = makeJob("fade-video", {
      videoUrl: "https://vid.mp4",
      fadeIn: true, fadeInDuration: 1,
      fadeOut: true, fadeOutDuration: 2,
      color: "black",
    })
    const ctx = makeCtx()
    await handler(job as never, ctx)

    expect(mocks.mockFadeVideo).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4",
      fadeIn: true, fadeInDuration: 1,
      fadeOut: true, fadeOutDuration: 2,
      color: "black",
    })
    expect(mocks.mockCompleteFfmpegVideoJob).toHaveBeenCalledWith("/tmp/fade-work/output.mp4", ctx)
  })
})

// ---------------------------------------------------------------------------
// resize-video
// ---------------------------------------------------------------------------

describe("resize-video handler", () => {
  const handler = ffmpegHandlers["resize-video"]

  it("delegates to resizeVideo then completeFfmpegVideoJob", async () => {
    const job = makeJob("resize-video", {
      videoUrl: "https://vid.mp4",
      targetAspect: "16:9",
      method: "crop",
    })
    const ctx = makeCtx()
    await handler(job as never, ctx)

    expect(mocks.mockResizeVideo).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4",
      targetAspect: "16:9",
      method: "crop",
      padColor: undefined,
    })
    expect(mocks.mockCompleteFfmpegVideoJob).toHaveBeenCalledWith("/tmp/resize-work/output.mp4", ctx)
  })
})

// ---------------------------------------------------------------------------
// add-captions
// ---------------------------------------------------------------------------

describe("add-captions handler", () => {
  const handler = ffmpegHandlers["add-captions"]

  it("delegates to addCaptions then completeFfmpegVideoJob", async () => {
    const job = makeJob("add-captions", {
      videoUrl: "https://vid.mp4",
      text: "Hello world",
      style: "subtitle",
      position: "bottom",
    })
    const ctx = makeCtx()
    await handler(job as never, ctx)

    expect(mocks.mockAddCaptions).toHaveBeenCalledWith({
      videoUrl: "https://vid.mp4",
      text: "Hello world",
      style: "subtitle",
      position: "bottom",
      fontSize: undefined,
      color: undefined,
      backgroundColor: undefined,
    })
    expect(mocks.mockCompleteFfmpegVideoJob).toHaveBeenCalledWith("/tmp/captions-work/output.mp4", ctx)
  })
})

// ---------------------------------------------------------------------------
// mix-audio
// ---------------------------------------------------------------------------

describe("mix-audio handler", () => {
  const handler = ffmpegHandlers["mix-audio"]

  it("delegates to mixAudio then completeFfmpegAudioJob", async () => {
    const job = makeJob("mix-audio", {
      audioUrls: ["https://a.mp3", "https://b.mp3"],
      trackVolumes: [100, 50],
    })
    const ctx = makeCtx()
    await handler(job as never, ctx)

    expect(mocks.mockMixAudio).toHaveBeenCalledWith({
      audioUrls: ["https://a.mp3", "https://b.mp3"],
      trackVolumes: [100, 50],
    })
    expect(mocks.mockCompleteFfmpegAudioJob).toHaveBeenCalledWith("/tmp/mix-work/output.mp3", ctx)
  })
})

// ---------------------------------------------------------------------------
// transcode-video
// ---------------------------------------------------------------------------

describe("transcode-video handler", () => {
  const handler = ffmpegHandlers["transcode-video"]

  it("default path uses BROWSER_SAFE_VIDEO_ARGS", async () => {
    const job = makeJob("transcode-video", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockCreateWorkDir).toHaveBeenCalledWith("transcode")
    expect(mocks.mockDownloadFile).toHaveBeenCalledWith("https://vid.mp4", "/tmp/transcode-work/input.mp4")
    expect(mocks.mockRunFfmpeg).toHaveBeenCalledWith([
      "-y", "-i", "/tmp/transcode-work/input.mp4",
      ...mocks.BROWSER_SAFE_VIDEO_ARGS,
      "-c:a", "aac", "-b:a", "128k",
      "/tmp/transcode-work/output.mp4",
    ])
    expect(mocks.mockCompleteFfmpegVideoJob).toHaveBeenCalledWith("/tmp/transcode-work/output.mp4", expect.any(Object))
  })

  it("custom codec h264 uses libx264", async () => {
    const job = makeJob("transcode-video", { videoUrl: "https://vid.mp4", codec: "h264", crf: 20 })
    await handler(job as never, makeCtx())

    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args).toContain("-c:v")
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264")
    expect(args).toContain("-crf")
    expect(args[args.indexOf("-crf") + 1]).toBe("20")
  })

  it("custom codec h265 uses libx265", async () => {
    const job = makeJob("transcode-video", { videoUrl: "https://vid.mp4", codec: "h265" })
    await handler(job as never, makeCtx())

    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx265")
  })

  it("custom crf defaults to 23 when not specified", async () => {
    const job = makeJob("transcode-video", { videoUrl: "https://vid.mp4", codec: "h264" })
    await handler(job as never, makeCtx())

    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args[args.indexOf("-crf") + 1]).toBe("23")
  })

  it("applies custom resolution scale filter", async () => {
    const job = makeJob("transcode-video", { videoUrl: "https://vid.mp4", codec: "h264", resolution: "720p" })
    await handler(job as never, makeCtx())

    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args).toContain("-vf")
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=-2:720")
  })

  it("ignores 'original' resolution (no scale filter)", async () => {
    const job = makeJob("transcode-video", { videoUrl: "https://vid.mp4", codec: "h264", resolution: "original" })
    await handler(job as never, makeCtx())

    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args).not.toContain("-vf")
  })

  it("applies custom audioBitrate", async () => {
    const job = makeJob("transcode-video", { videoUrl: "https://vid.mp4", codec: "h264", audioBitrate: "256k" })
    await handler(job as never, makeCtx())

    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args[args.indexOf("-b:a") + 1]).toBe("256k")
  })

  it("defaults audioBitrate to 128k when custom path but no audioBitrate", async () => {
    const job = makeJob("transcode-video", { videoUrl: "https://vid.mp4", codec: "h264" })
    await handler(job as never, makeCtx())

    const args = mocks.mockRunFfmpeg.mock.calls[0][0]
    expect(args[args.indexOf("-b:a") + 1]).toBe("128k")
  })
})

// ---------------------------------------------------------------------------
// adjust-volume
// ---------------------------------------------------------------------------

describe("adjust-volume handler", () => {
  const handler = ffmpegHandlers["adjust-volume"]

  it("video input path: uploads as video, generates thumbnail", async () => {
    mocks.mockAdjustVolume.mockResolvedValueOnce({ outputPath: "/tmp/vol/out.mp4", inputType: "video" })
    const job = makeJob("adjust-volume", { videoUrl: "https://vid.mp4", volume: 150 })
    await handler(job as never, makeCtx())

    expect(mocks.mockAdjustVolume).toHaveBeenCalledWith({
      audioUrl: undefined,
      videoUrl: "https://vid.mp4",
      volume: 150,
      normalize: undefined,
      fadeIn: undefined,
      fadeOut: undefined,
    })
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/vol/out.mp4", "job-1", "video", "user-1")
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
        output_data: expect.objectContaining({
          videoUrl: expect.any(String),
          thumbnailUrl: expect.any(String),
          inputType: "video",
        }),
      }),
    )
  })

  it("audio input path: uploads as audio, no thumbnail", async () => {
    mocks.mockAdjustVolume.mockResolvedValueOnce({ outputPath: "/tmp/vol/out.mp3", inputType: "audio" })
    const job = makeJob("adjust-volume", { audioUrl: "https://audio.mp3", volume: 80 })
    await handler(job as never, makeCtx())

    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/vol/out.mp3", "job-1", "audio", "user-1")
    expect(mocks.mockGenerateAndUploadThumbnail).not.toHaveBeenCalled()
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
        output_data: expect.objectContaining({
          audioUrl: expect.any(String),
          inputType: "audio",
        }),
      }),
    )
  })

  it("cleans up work dir after upload", async () => {
    mocks.mockAdjustVolume.mockResolvedValueOnce({ outputPath: "/tmp/vol/out.mp4", inputType: "video" })
    const job = makeJob("adjust-volume", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith("/tmp/vol")
  })
})

// ---------------------------------------------------------------------------
// combine-videos: Stage-3 per-boundary transitions + film-edge fades. The
// route validates them; the worker's only job is to hand them to the provider
// untouched (a route that accepts a field the worker drops is worse than a
// route that never accepted it).
// ---------------------------------------------------------------------------

describe("combine-videos handler — transitions[] + edgeFades", () => {
  const handler = ffmpegHandlers["combine-videos"]

  it("forwards transitions[] and edgeFades to combineVideos verbatim", async () => {
    const job = makeJob("combine-videos", {
      videoUrls: ["https://a.mp4", "https://b.mp4", "https://c.mp4"],
      transition: "cut",
      transitionDuration: 0,
      transitions: [{ index: 1, transition: "dip-to-black", duration: 0.5 }],
      edgeFades: { in: 0.5, out: 1 },
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockCombineVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        transitions: [{ index: 1, transition: "dip-to-black", duration: 0.5 }],
        edgeFades: { in: 0.5, out: 1 },
      }),
    )
  })

  it("omits both when the job carries neither (byte-identical to today)", async () => {
    const job = makeJob("combine-videos", {
      videoUrls: ["https://a.mp4", "https://b.mp4"],
      transition: "fade",
      transitionDuration: 1,
    })
    await handler(job as never, makeCtx())

    const passed = mocks.mockCombineVideos.mock.calls[0][0] as Record<string, unknown>
    expect(passed.transitions).toBeUndefined()
    expect(passed.edgeFades).toBeUndefined()
  })
})
