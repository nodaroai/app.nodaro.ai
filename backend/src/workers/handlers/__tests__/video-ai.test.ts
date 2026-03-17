import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockImageToVideo = vi.fn()
  const mockTextToVideo = vi.fn()
  const mockVideoToVideo = vi.fn()
  const mockLipSync = vi.fn()
  const mockMotionTransfer = vi.fn()
  const mockVideoUpscale = vi.fn()

  const mockSpeechToVideo = vi.fn()
  const mockSoraStoryboard = vi.fn()

  const mockUploadToR2 = vi.fn().mockResolvedValue("https://r2.example.com/videos/raw.mp4")
  const mockMergeVideoAudio = vi.fn().mockResolvedValue("/tmp/workdir/merged.mp4")
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)

  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockUploadVideoMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  const mockWatermarkLocalVideoAndUpload = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1-merged.mp4")
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")

  // Supabase chain
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockImageToVideo,
    mockTextToVideo,
    mockVideoToVideo,
    mockLipSync,
    mockMotionTransfer,
    mockVideoUpscale,
    mockSpeechToVideo,
    mockSoraStoryboard,
    mockUploadToR2,
    mockMergeVideoAudio,
    mockCleanupWorkDir,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockUploadVideoMaybeWatermark,
    mockWatermarkLocalVideoAndUpload,
    mockGenerateAndUploadThumbnail,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/lib/storage.js", () => ({
  uploadToR2: mocks.mockUploadToR2,
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: mocks.mockTextToVideo,
  videoToVideo: mocks.mockVideoToVideo,
  lipSync: mocks.mockLipSync,
  motionTransfer: mocks.mockMotionTransfer,
  videoUpscale: mocks.mockVideoUpscale,
}))

vi.mock("@/providers/video/merge-video-audio.js", () => ({
  mergeVideoAudio: mocks.mockMergeVideoAudio,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: mocks.mockCleanupWorkDir,
}))

vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
  watermarkLocalVideoAndUpload: mocks.mockWatermarkLocalVideoAndUpload,
  generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
}))

vi.mock("@/providers/kie/video.js", () => ({
  KieVideoProvider: class {
    speechToVideo = mocks.mockSpeechToVideo
    soraStoryboard = mocks.mockSoraStoryboard
  },
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { videoAIHandlers } from "../video-ai.js"

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

const VIDEO_RESULT = {
  url: "https://provider.example.com/video.mp4",
  providerUsed: "minimax",
  cost: 0.40,
  displayCost: 0.50,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const S2V_RESULT = {
  url: "https://provider.example.com/s2v.mp4",
  cost: 0.06,
}

const STORYBOARD_RESULT = {
  url: "https://provider.example.com/storyboard.mp4",
  cost: 0.75,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockImageToVideo.mockResolvedValue(VIDEO_RESULT)
  mocks.mockTextToVideo.mockResolvedValue(VIDEO_RESULT)
  mocks.mockVideoToVideo.mockResolvedValue(VIDEO_RESULT)
  mocks.mockLipSync.mockResolvedValue(VIDEO_RESULT)
  mocks.mockMotionTransfer.mockResolvedValue(VIDEO_RESULT)
  mocks.mockVideoUpscale.mockResolvedValue(VIDEO_RESULT)
  mocks.mockSpeechToVideo.mockResolvedValue(S2V_RESULT)
  mocks.mockSoraStoryboard.mockResolvedValue(STORYBOARD_RESULT)
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.mockUploadToR2.mockResolvedValue("https://r2.example.com/videos/raw.mp4")
  mocks.mockMergeVideoAudio.mockResolvedValue("/tmp/workdir/merged.mp4")
  mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue("https://r2.example.com/videos/job-1-merged.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
})

// ---------------------------------------------------------------------------
// image-to-video
// ---------------------------------------------------------------------------

describe("image-to-video handler", () => {
  const handler = videoAIHandlers["image-to-video"]

  it("happy path without audio: uploads with watermark check, generates thumbnail", async () => {
    const job = makeJob("image-to-video", { imageUrl: "https://img.png", prompt: "animate" })
    await handler(job as never, makeCtx())

    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://img.png", "minimax", "animate", undefined, undefined,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(
      VIDEO_RESULT.url, "job-1", "user-1", false,
    )
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", VIDEO_RESULT.cost)
  })

  it("audio merge branch: uploads raw → merges → watermarks local", async () => {
    const job = makeJob("image-to-video", {
      imageUrl: "https://img.png",
      audioUrl: "https://audio.mp3",
      prompt: "with sound",
    })
    await handler(job as never, makeCtx())

    // Should upload raw without watermark
    expect(mocks.mockUploadToR2).toHaveBeenCalledWith(VIDEO_RESULT.url, "job-1", "video", "user-1")
    expect(mocks.mockUploadVideoMaybeWatermark).not.toHaveBeenCalled()

    // Should merge
    expect(mocks.mockMergeVideoAudio).toHaveBeenCalledWith({
      videoUrl: "https://r2.example.com/videos/raw.mp4",
      audioUrl: "https://audio.mp3",
      voiceoverVolume: 100,
      backgroundVolume: 30,
      keepOriginalAudio: false,
    })

    // Should watermark the merged file
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(
      "/tmp/workdir/merged.mp4", "job-1-merged", "user-1", false,
    )

    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith("/tmp/workdir")
  })

  it("generateAudio=true sets keepOriginalAudio=true in merge", async () => {
    const job = makeJob("image-to-video", {
      imageUrl: "https://img.png",
      audioUrl: "https://audio.mp3",
      generateAudio: true,
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockMergeVideoAudio).toHaveBeenCalledWith(
      expect.objectContaining({ keepOriginalAudio: true }),
    )
  })

  it("passes progress callback that updates DB", async () => {
    const job = makeJob("image-to-video", { imageUrl: "https://img.png" })
    await handler(job as never, makeCtx())

    // Grab the onProgress callback from the call
    const opts = mocks.mockImageToVideo.mock.calls[0][5]
    await opts.onProgress(42)

    expect(mocks.mockFrom).toHaveBeenCalledWith("jobs")
    expect(mocks.mockUpdate).toHaveBeenCalledWith({ progress: 42 })
  })

  it("maps shots to multiPrompt format", async () => {
    const shots = [
      { prompt: "shot 1", duration: 5 },
      { prompt: "shot 2", duration: 10 },
    ]
    const job = makeJob("image-to-video", { imageUrl: "https://img.png", shots })
    await handler(job as never, makeCtx())

    const opts = mocks.mockImageToVideo.mock.calls[0][5]
    expect(opts.multiPrompt).toEqual([
      { prompt: "shot 1", duration: 5 },
      { prompt: "shot 2", duration: 10 },
    ])
  })

  it("maps elements to klingElements format (image type)", async () => {
    const elements = [
      { name: "char", description: "hero", type: "image" as const, urls: ["https://a.png"] },
    ]
    const job = makeJob("image-to-video", { imageUrl: "https://img.png", elements })
    await handler(job as never, makeCtx())

    const opts = mocks.mockImageToVideo.mock.calls[0][5]
    expect(opts.klingElements).toEqual([
      { name: "char", description: "hero", element_input_urls: ["https://a.png"] },
    ])
  })

  it("maps elements to klingElements format (video type)", async () => {
    const elements = [
      { name: "bg", description: "background", type: "video" as const, urls: ["https://v.mp4"] },
    ]
    const job = makeJob("image-to-video", { imageUrl: "https://img.png", elements })
    await handler(job as never, makeCtx())

    const opts = mocks.mockImageToVideo.mock.calls[0][5]
    expect(opts.klingElements).toEqual([
      { name: "bg", description: "background", element_input_video_urls: ["https://v.mp4"] },
    ])
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("image-to-video", { imageUrl: "https://img.png" })
    await handler(job as never, makeCtx())

    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("uses default provider 'minimax' when none specified", async () => {
    const job = makeJob("image-to-video", { imageUrl: "https://img.png" })
    await handler(job as never, makeCtx())

    expect(mocks.mockImageToVideo).toHaveBeenCalledWith(
      "https://img.png", "minimax", undefined, undefined, undefined,
      expect.any(Object),
    )
  })
})

// ---------------------------------------------------------------------------
// video-to-video
// ---------------------------------------------------------------------------

describe("video-to-video handler", () => {
  const handler = videoAIHandlers["video-to-video"]

  it("happy path: transforms, uploads, saves, commits credits", async () => {
    const job = makeJob("video-to-video", { videoUrl: "https://vid.mp4", prompt: "stylize" })
    await handler(job as never, makeCtx())

    expect(mocks.mockVideoToVideo).toHaveBeenCalledWith("https://vid.mp4", "wan", "stylize")
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", VIDEO_RESULT.cost)
  })

  it("uses default provider 'wan' when none specified", async () => {
    const job = makeJob("video-to-video", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockVideoToVideo).toHaveBeenCalledWith("https://vid.mp4", "wan", undefined)
  })

  it("uses custom provider when specified", async () => {
    const job = makeJob("video-to-video", { videoUrl: "https://vid.mp4", provider: "custom" })
    await handler(job as never, makeCtx())

    expect(mocks.mockVideoToVideo).toHaveBeenCalledWith("https://vid.mp4", "custom", undefined)
  })
})

// ---------------------------------------------------------------------------
// text-to-video
// ---------------------------------------------------------------------------

describe("text-to-video handler", () => {
  const handler = videoAIHandlers["text-to-video"]

  it("happy path: generates, uploads, saves, commits credits", async () => {
    const job = makeJob("text-to-video", { prompt: "a sunset" })
    await handler(job as never, makeCtx())

    expect(mocks.mockTextToVideo).toHaveBeenCalledWith(
      "a sunset", "minimax", undefined, undefined, expect.any(Object),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", VIDEO_RESULT.cost)
  })

  it("uses default provider 'minimax' when none specified", async () => {
    const job = makeJob("text-to-video", { prompt: "test" })
    await handler(job as never, makeCtx())

    expect(mocks.mockTextToVideo).toHaveBeenCalledWith(
      "test", "minimax", undefined, undefined, expect.any(Object),
    )
  })

  it("maps shots to multiPrompt format", async () => {
    const shots = [{ prompt: "s1", duration: 3 }]
    const job = makeJob("text-to-video", { prompt: "multi", shots })
    await handler(job as never, makeCtx())

    const opts = mocks.mockTextToVideo.mock.calls[0][4]
    expect(opts.multiPrompt).toEqual([{ prompt: "s1", duration: 3 }])
  })

  it("maps elements to klingElements format", async () => {
    const elements = [
      { name: "obj", description: "thing", type: "image" as const, urls: ["https://x.png"] },
    ]
    const job = makeJob("text-to-video", { prompt: "with elements", elements })
    await handler(job as never, makeCtx())

    const opts = mocks.mockTextToVideo.mock.calls[0][4]
    expect(opts.klingElements).toEqual([
      { name: "obj", description: "thing", element_input_urls: ["https://x.png"] },
    ])
  })
})

// ---------------------------------------------------------------------------
// lip-sync
// ---------------------------------------------------------------------------

describe("lip-sync handler", () => {
  const handler = videoAIHandlers["lip-sync"]

  it("happy path: syncs, uploads, saves, commits credits", async () => {
    const job = makeJob("lip-sync", {
      imageUrl: "https://face.png",
      audioUrl: "https://speech.mp3",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockLipSync).toHaveBeenCalledWith(
      "https://face.png", "https://speech.mp3", "kling-avatar", undefined, undefined,
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", VIDEO_RESULT.cost)
  })

  it("uses default provider 'kling-avatar' when none specified", async () => {
    const job = makeJob("lip-sync", {
      imageUrl: "https://face.png",
      audioUrl: "https://speech.mp3",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockLipSync).toHaveBeenCalledWith(
      "https://face.png", "https://speech.mp3", "kling-avatar", undefined, undefined,
    )
  })

  it("passes custom provider and resolution", async () => {
    const job = makeJob("lip-sync", {
      imageUrl: "https://face.png",
      audioUrl: "https://speech.mp3",
      provider: "hailuo-avatar",
      resolution: "1080p",
      prompt: "talking",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockLipSync).toHaveBeenCalledWith(
      "https://face.png", "https://speech.mp3", "hailuo-avatar", "talking", "1080p",
    )
  })
})

// ---------------------------------------------------------------------------
// motion-transfer
// ---------------------------------------------------------------------------

describe("motion-transfer handler", () => {
  const handler = videoAIHandlers["motion-transfer"]

  it("happy path: transfers motion, uploads, saves, commits credits", async () => {
    const job = makeJob("motion-transfer", {
      imageUrl: "https://img.png",
      videoUrl: "https://motion.mp4",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockMotionTransfer).toHaveBeenCalledWith(
      "https://img.png", "https://motion.mp4", "kling", undefined,
      expect.objectContaining({
        onProgress: expect.any(Function),
        characterOrientation: "image",
        resolution: "720p",
      }),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", VIDEO_RESULT.cost)
  })

  it("always uses hardcoded 'kling' provider", async () => {
    const job = makeJob("motion-transfer", {
      imageUrl: "https://img.png",
      videoUrl: "https://motion.mp4",
    })
    await handler(job as never, makeCtx())

    // Verify the third argument is always "kling"
    expect(mocks.mockMotionTransfer.mock.calls[0][2]).toBe("kling")
  })

  it("passes progress callback that updates DB", async () => {
    const job = makeJob("motion-transfer", {
      imageUrl: "https://img.png",
      videoUrl: "https://motion.mp4",
    })
    await handler(job as never, makeCtx())

    const opts = mocks.mockMotionTransfer.mock.calls[0][4]
    await opts.onProgress(55)

    expect(mocks.mockUpdate).toHaveBeenCalledWith({ progress: 55 })
  })

  it("uses custom orientation and resolution when provided", async () => {
    const job = makeJob("motion-transfer", {
      imageUrl: "https://img.png",
      videoUrl: "https://motion.mp4",
      characterOrientation: "video",
      resolution: "1080p",
    })
    await handler(job as never, makeCtx())

    const opts = mocks.mockMotionTransfer.mock.calls[0][4]
    expect(opts.characterOrientation).toBe("video")
    expect(opts.resolution).toBe("1080p")
  })

  it("defaults to orientation='image' and resolution='720p'", async () => {
    const job = makeJob("motion-transfer", {
      imageUrl: "https://img.png",
      videoUrl: "https://motion.mp4",
    })
    await handler(job as never, makeCtx())

    const opts = mocks.mockMotionTransfer.mock.calls[0][4]
    expect(opts.characterOrientation).toBe("image")
    expect(opts.resolution).toBe("720p")
  })
})

// ---------------------------------------------------------------------------
// video-upscale
// ---------------------------------------------------------------------------

describe("video-upscale handler", () => {
  const handler = videoAIHandlers["video-upscale"]

  it("happy path: upscales, uploads, saves, commits credits", async () => {
    const job = makeJob("video-upscale", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockVideoUpscale).toHaveBeenCalledWith(
      "https://vid.mp4", "topaz", "2",
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("always uses hardcoded 'topaz' provider", async () => {
    const job = makeJob("video-upscale", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockVideoUpscale).toHaveBeenCalledWith(
      expect.anything(), "topaz", expect.anything(), expect.anything(),
    )
  })

  it("passes progress callback that updates DB", async () => {
    const job = makeJob("video-upscale", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    const opts = mocks.mockVideoUpscale.mock.calls[0][3]
    await opts.onProgress(75)

    expect(mocks.mockUpdate).toHaveBeenCalledWith({ progress: 75 })
  })

  it("defaults to upscaleFactor '2' when not specified", async () => {
    const job = makeJob("video-upscale", { videoUrl: "https://vid.mp4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockVideoUpscale).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "2", expect.anything(),
    )
  })

  it("uses custom upscaleFactor when specified", async () => {
    const job = makeJob("video-upscale", { videoUrl: "https://vid.mp4", upscaleFactor: "4" })
    await handler(job as never, makeCtx())

    expect(mocks.mockVideoUpscale).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "4", expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// speech-to-video
// ---------------------------------------------------------------------------

describe("speech-to-video handler", () => {
  const handler = videoAIHandlers["speech-to-video"]

  it("happy path: generates, uploads, saves, commits credits", async () => {
    const job = makeJob("speech-to-video", {
      imageUrl: "https://img.png",
      audioUrl: "https://audio.mp3",
      prompt: "talking head",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockSpeechToVideo).toHaveBeenCalledWith(
      "https://img.png", "https://audio.mp3", "talking head", undefined,
      expect.objectContaining({}),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", S2V_RESULT.cost)
  })

  it("passes resolution and optional params", async () => {
    const job = makeJob("speech-to-video", {
      imageUrl: "https://img.png",
      audioUrl: "https://audio.mp3",
      prompt: "talking",
      resolution: "720p",
      seed: 42,
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockSpeechToVideo).toHaveBeenCalledWith(
      "https://img.png", "https://audio.mp3", "talking", "720p",
      expect.objectContaining({ seed: 42 }),
    )
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("speech-to-video", {
      imageUrl: "https://img.png",
      audioUrl: "https://audio.mp3",
      prompt: "cancel",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// sora-storyboard
// ---------------------------------------------------------------------------

describe("sora-storyboard handler", () => {
  const handler = videoAIHandlers["sora-storyboard"]

  it("happy path: generates storyboard video, uploads, saves, commits credits", async () => {
    const shots = [
      { scene: "A sunset over the ocean", duration: 3 },
      { scene: "A bird flying", duration: 2 },
    ]
    const job = makeJob("sora-storyboard", { shots })
    await handler(job as never, makeCtx())

    expect(mocks.mockSoraStoryboard).toHaveBeenCalledWith(
      shots, undefined, undefined, undefined, expect.any(Function),
    )
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockGenerateAndUploadThumbnail).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", STORYBOARD_RESULT.cost)
  })

  it("passes nFrames, imageUrls, and aspectRatio when provided", async () => {
    const shots = [{ scene: "test", duration: 5 }]
    const job = makeJob("sora-storyboard", {
      shots,
      nFrames: "15",
      imageUrls: ["https://img1.png"],
      aspectRatio: "portrait",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockSoraStoryboard).toHaveBeenCalledWith(
      shots, "15", ["https://img1.png"], "portrait", expect.any(Function),
    )
  })

  it("passes progress callback that updates DB", async () => {
    const shots = [{ scene: "test", duration: 5 }]
    const job = makeJob("sora-storyboard", { shots })
    await handler(job as never, makeCtx())

    // Grab the onProgress callback from the call
    const onProgress = mocks.mockSoraStoryboard.mock.calls[0][4]
    await onProgress(60)

    expect(mocks.mockUpdate).toHaveBeenCalledWith({ progress: 60 })
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const shots = [{ scene: "cancel", duration: 5 }]
    const job = makeJob("sora-storyboard", { shots })
    await handler(job as never, makeCtx())

    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})
