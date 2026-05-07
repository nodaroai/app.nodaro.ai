import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockUploadFileToR2 = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")

  // FFmpeg operation functions
  const mockCombineVideos = vi.fn().mockResolvedValue("/tmp/combine-work/output.mp4")
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

  // ffmpeg-utils
  const mockCreateWorkDir = vi.fn().mockResolvedValue("/tmp/transcode-work")
  const mockDownloadFile = vi.fn().mockResolvedValue(undefined)
  const mockRunFfmpeg = vi.fn().mockResolvedValue(undefined)
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  const BROWSER_SAFE_VIDEO_ARGS = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23", "-movflags", "+faststart"]

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
    mockCreateWorkDir,
    mockDownloadFile,
    mockRunFfmpeg,
    mockCleanupWorkDir,
    BROWSER_SAFE_VIDEO_ARGS,
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
  uploadFileToR2: mocks.mockUploadFileToR2,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: mocks.mockCreateWorkDir,
  downloadFile: mocks.mockDownloadFile,
  runFfmpeg: mocks.mockRunFfmpeg,
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  BROWSER_SAFE_VIDEO_ARGS: mocks.BROWSER_SAFE_VIDEO_ARGS,
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
// combine-videos
// ---------------------------------------------------------------------------

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

  it("uploads silent video when outputSilentVideo=true", async () => {
    mocks.mockTrimVideo.mockResolvedValueOnce({
      videoPath: "/tmp/trim-work/output.mp4",
      silentVideoPath: "/tmp/trim-work/silent.mp4",
    })
    mocks.mockUploadFileToR2
      .mockResolvedValueOnce("https://r2.example.com/video.mp4")
      .mockResolvedValueOnce("https://r2.example.com/silent.mp4")

    const job = makeJob("trim-video", { videoUrl: "https://vid.mp4", startTime: 5, endTime: 15, outputSilentVideo: true })
    await handler(job as never, makeCtx())

    expect(mocks.mockUploadFileToR2).toHaveBeenCalledTimes(2)
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/trim-work/output.mp4", "job-1", "video", "user-1")
    expect(mocks.mockUploadFileToR2).toHaveBeenCalledWith("/tmp/trim-work/silent.mp4", "job-1-silent", "video", "user-1")
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
        output_data: expect.objectContaining({
          videoUrl: "https://r2.example.com/video.mp4",
          videoUrlSilent: "https://r2.example.com/silent.mp4",
        }),
      }),
    )
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
