import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockRefundJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/test.png")
  const mockCreateAssetFromJob = vi.fn().mockResolvedValue(undefined)
  const mockUploadFileToR2 = vi.fn().mockResolvedValue("https://r2.example.com/videos/test.mp4")
  const mockApplyVideoWatermark = vi.fn().mockResolvedValue(undefined)
  const mockCreateWorkDir = vi.fn().mockResolvedValue("/tmp/render-test")
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  const mockDownloadFile = vi.fn().mockResolvedValue(undefined)
  const mockRunFfmpeg = vi.fn().mockResolvedValue(undefined)
  const mockNeedsTranscode = vi.fn().mockResolvedValue(false)
  const mockTranscodeToBrowserSafe = vi.fn().mockImplementation((input: string) => Promise.resolve(input))
  const mockValidatePlanByType = vi.fn().mockImplementation((_type: string, plan: unknown) => plan)

  // Supabase mock
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    update: mockUpdate,
  })

  return {
    mockCommitJobCredits,
    mockRefundJobCredits,
    mockShouldSaveJobResult,
    mockGenerateAndUploadThumbnail,
    mockCreateAssetFromJob,
    mockUploadFileToR2,
    mockApplyVideoWatermark,
    mockCreateWorkDir,
    mockCleanupWorkDir,
    mockDownloadFile,
    mockRunFfmpeg,
    mockNeedsTranscode,
    mockTranscodeToBrowserSafe,
    mockValidatePlanByType,
    mockFrom,
    mockSingle,
    mockEq,
    mockUpdate,
  }
})

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", REMOTION_CONCURRENCY: undefined },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/lib/storage.js", () => ({
  uploadFileToR2: mocks.mockUploadFileToR2,
}))

vi.mock("@/utils/watermark.js", () => ({
  applyVideoWatermark: mocks.mockApplyVideoWatermark,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: mocks.mockCreateWorkDir,
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  downloadFile: mocks.mockDownloadFile,
  runFfmpeg: mocks.mockRunFfmpeg,
  needsTranscode: mocks.mockNeedsTranscode,
  transcodeToBrowserSafe: mocks.mockTranscodeToBrowserSafe,
  BROWSER_SAFE_VIDEO_ARGS: ["-c:v", "libx264"],
  REMOTION_INPUT_VIDEO_ARGS: ["-c:v", "libx264", "-g", "1"],
}))

vi.mock("../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  refundJobCredits: mocks.mockRefundJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
  createAssetFromJob: mocks.mockCreateAssetFromJob,
}))

vi.mock("@/lib/plan-schemas.js", () => ({
  validatePlanByType: mocks.mockValidatePlanByType,
}))

// Mock Remotion and Node.js modules that aren't needed for pure function tests
vi.mock("bullmq", () => ({ Worker: vi.fn() }))
vi.mock("ioredis", () => ({ default: vi.fn().mockReturnValue({}) }))
vi.mock("@remotion/bundler", () => ({ bundle: vi.fn() }))
vi.mock("@remotion/renderer", () => ({
  selectComposition: vi.fn(),
  renderMedia: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import module under test (pure functions)
// ---------------------------------------------------------------------------

import {
  isPlanJob,
  isSceneGraphJob,
  buildPlanRender,
  buildSceneGraphRender,
  buildLegacyRender,
  canUseFfmpegFastPath,
  collectVideoUrls,
  replaceVideoUrls,
  type SceneGraphData,
} from "../render-worker.js"

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// isPlanJob / isSceneGraphJob
// ---------------------------------------------------------------------------

describe("isPlanJob", () => {
  it("returns true for plan job data", () => {
    expect(isPlanJob({ jobId: "1", planType: "after-effects", plan: {} })).toBe(true)
  })

  it("returns false for scene graph job data", () => {
    expect(isPlanJob({ jobId: "1", sceneGraph: { fps: 30, width: 1920, height: 1080, durationInFrames: 300, backgroundColor: "#000", tracks: [] } })).toBe(false)
  })

  it("returns false for legacy job data", () => {
    const legacy = {
      jobId: "1", template: "slideshow", fps: 30, width: 1920, height: 1080,
      durationInFrames: 300, transitionStyle: "fade", transitionDurationFrames: 15,
      mediaAssets: [], textOverlays: [], captions: { enabled: false, style: "", position: "", fontSize: 16, color: "#fff" },
      backgroundColor: "#000", kenBurnsEnabled: false,
    }
    expect(isPlanJob(legacy)).toBe(false)
  })
})

describe("isSceneGraphJob", () => {
  it("returns true for scene graph job data", () => {
    expect(isSceneGraphJob({
      jobId: "1",
      sceneGraph: { fps: 30, width: 1920, height: 1080, durationInFrames: 300, backgroundColor: "#000", tracks: [] },
    })).toBe(true)
  })

  it("returns false for plan job data", () => {
    expect(isSceneGraphJob({ jobId: "1", planType: "after-effects", plan: {} })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildPlanRender
// ---------------------------------------------------------------------------

describe("buildPlanRender", () => {
  it("routes plan to correct composition and extracts dimensions", () => {
    const plan = { width: 1280, height: 720, fps: 24, durationInFrames: 240 }
    const result = buildPlanRender({ jobId: "1", planType: "after-effects", plan })

    expect(result.compositionId).toBe("after-effects")
    expect(result.inputProps).toEqual({ plan })
    expect(result.width).toBe(1280)
    expect(result.height).toBe(720)
    expect(result.fps).toBe(24)
    expect(result.durationInFrames).toBe(240)
    expect(mocks.mockValidatePlanByType).toHaveBeenCalledWith("after-effects", plan)
  })

  it("uses defaults when plan has no dimensions", () => {
    const plan = {}
    const result = buildPlanRender({ jobId: "1", planType: "lottie-overlay", plan })

    expect(result.compositionId).toBe("lottie-overlay")
    expect(result.width).toBe(1920)
    expect(result.height).toBe(1080)
    expect(result.fps).toBe(30)
    expect(result.durationInFrames).toBe(300)
  })
})

// ---------------------------------------------------------------------------
// buildSceneGraphRender
// ---------------------------------------------------------------------------

describe("buildSceneGraphRender", () => {
  it("maps sceneGraph fields to composition config", () => {
    const sceneGraph: SceneGraphData = {
      fps: 60,
      width: 3840,
      height: 2160,
      durationInFrames: 600,
      backgroundColor: "#ff0000",
      tracks: [{ type: "media", segments: [] }],
    }

    const result = buildSceneGraphRender({ jobId: "1", sceneGraph })

    expect(result.compositionId).toBe("scene-graph")
    expect(result.inputProps).toEqual({ sceneGraph })
    expect(result.width).toBe(3840)
    expect(result.height).toBe(2160)
    expect(result.fps).toBe(60)
    expect(result.durationInFrames).toBe(600)
  })
})

// ---------------------------------------------------------------------------
// buildLegacyRender
// ---------------------------------------------------------------------------

describe("buildLegacyRender", () => {
  it("maps legacy template data to inputProps with url->src conversion", () => {
    const data = {
      jobId: "1",
      template: "explainer",
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 300,
      transitionStyle: "fade",
      transitionDurationFrames: 15,
      mediaAssets: [
        { url: "https://example.com/img.png", type: "image" as const },
        { url: "https://example.com/vid.mp4", type: "video" as const, durationSeconds: 5 },
      ],
      audioTrackUrl: "https://example.com/audio.mp3",
      textOverlays: [],
      captions: { enabled: false, style: "", position: "", fontSize: 16, color: "#fff" },
      backgroundColor: "#000000",
      kenBurnsEnabled: true,
    }

    const result = buildLegacyRender(data)

    expect(result.compositionId).toBe("explainer")
    expect(result.width).toBe(1920)
    expect(result.fps).toBe(30)
    // url -> src mapping
    expect(result.inputProps.mediaAssets[0].src).toBe("https://example.com/img.png")
    expect(result.inputProps.mediaAssets[1].src).toBe("https://example.com/vid.mp4")
    expect(result.inputProps.audioTrackUrl).toBe("https://example.com/audio.mp3")
    expect(result.inputProps.kenBurnsEnabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// canUseFfmpegFastPath
// ---------------------------------------------------------------------------

describe("canUseFfmpegFastPath", () => {
  function makeSceneGraph(overrides: Partial<SceneGraphData> = {}): SceneGraphData {
    return {
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 150,
      backgroundColor: "#000",
      tracks: [
        {
          type: "media",
          segments: [
            { mediaType: "video", src: "https://example.com/v.mp4", startFrame: 0, durationInFrames: 150 },
          ],
        },
      ],
      ...overrides,
    }
  }

  it("returns true for eligible scene graph (1 video, full duration, no effects)", () => {
    expect(canUseFfmpegFastPath(makeSceneGraph())).toBe(true)
  })

  it("returns true with audio tracks (audio is handled by FFmpeg)", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [{ mediaType: "video", src: "https://example.com/v.mp4", startFrame: 0, durationInFrames: 150 }],
        },
        { type: "audio", src: "https://example.com/music.mp3" },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(true)
  })

  it("returns false when text tracks present", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [{ mediaType: "video", src: "https://example.com/v.mp4", startFrame: 0, durationInFrames: 150 }],
        },
        { type: "text" },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(false)
  })

  it("returns false when multiple media tracks", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [{ mediaType: "video", src: "https://example.com/v1.mp4", startFrame: 0, durationInFrames: 150 }],
        },
        {
          type: "media",
          segments: [{ mediaType: "video", src: "https://example.com/v2.mp4", startFrame: 0, durationInFrames: 150 }],
        },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(false)
  })

  it("returns false when segment has effects", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [
            {
              mediaType: "video", src: "https://example.com/v.mp4",
              startFrame: 0, durationInFrames: 150,
              effects: [{ type: "brightness", value: 1.5 }],
            },
          ],
        },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(false)
  })

  it("returns false when segment has transitions", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [
            {
              mediaType: "video", src: "https://example.com/v.mp4",
              startFrame: 0, durationInFrames: 150,
              transitionIn: { type: "fade", durationInFrames: 15 },
            },
          ],
        },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(false)
  })

  it("returns false when segment doesn't start at frame 0", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [
            { mediaType: "video", src: "https://example.com/v.mp4", startFrame: 10, durationInFrames: 150 },
          ],
        },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(false)
  })

  it("returns false when segment doesn't span full composition", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [
            { mediaType: "video", src: "https://example.com/v.mp4", startFrame: 0, durationInFrames: 100 },
          ],
        },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(false)
  })

  it("returns false when segment is image not video", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [
            { mediaType: "image", src: "https://example.com/img.png", startFrame: 0, durationInFrames: 150 },
          ],
        },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(false)
  })

  it("returns false when multiple segments in single track", () => {
    const sg = makeSceneGraph({
      tracks: [
        {
          type: "media",
          segments: [
            { mediaType: "video", src: "https://example.com/v1.mp4", startFrame: 0, durationInFrames: 75 },
            { mediaType: "video", src: "https://example.com/v2.mp4", startFrame: 75, durationInFrames: 75 },
          ],
        },
      ],
    })
    expect(canUseFfmpegFastPath(sg)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// collectVideoUrls
// ---------------------------------------------------------------------------

describe("collectVideoUrls", () => {
  it("extracts video URLs from scene graph tracks", () => {
    const props = {
      sceneGraph: {
        tracks: [
          { type: "media", segments: [{ mediaType: "video", src: "https://cdn.example.com/v1.mp4" }] },
          { type: "media", segments: [{ mediaType: "image", src: "https://cdn.example.com/img.png" }] },
          { type: "media", segments: [{ mediaType: "video", src: "https://cdn.example.com/v2.mp4" }] },
          { type: "audio", src: "https://cdn.example.com/audio.mp3" },
        ],
      },
    }
    const urls = collectVideoUrls(props)
    expect(urls).toEqual(["https://cdn.example.com/v1.mp4", "https://cdn.example.com/v2.mp4"])
  })

  it("deduplicates URLs from scene graph", () => {
    const props = {
      sceneGraph: {
        tracks: [
          { type: "media", segments: [{ mediaType: "video", src: "https://cdn.example.com/v.mp4" }] },
          { type: "media", segments: [{ mediaType: "video", src: "https://cdn.example.com/v.mp4" }] },
        ],
      },
    }
    expect(collectVideoUrls(props)).toEqual(["https://cdn.example.com/v.mp4"])
  })

  it("extracts sourceVideo and layer videos from plan", () => {
    const props = {
      plan: {
        sourceVideo: "https://cdn.example.com/source.mp4",
        layers: [
          { sourceVideo: "https://cdn.example.com/layer1.mp4" },
          { sourceVideo: "https://cdn.example.com/layer2.mp4" },
        ],
      },
    }
    const urls = collectVideoUrls(props)
    expect(urls).toContain("https://cdn.example.com/source.mp4")
    expect(urls).toContain("https://cdn.example.com/layer1.mp4")
    expect(urls).toContain("https://cdn.example.com/layer2.mp4")
  })

  it("extracts backgroundMedia from plan when it matches video URL pattern", () => {
    const props = {
      plan: {
        backgroundMedia: "https://cdn.example.com/bg.mp4",
      },
    }
    const urls = collectVideoUrls(props)
    expect(urls).toContain("https://cdn.example.com/bg.mp4")
  })

  it("ignores non-video backgroundMedia in plan", () => {
    const props = {
      plan: {
        backgroundMedia: "https://cdn.example.com/bg.png",
      },
    }
    const urls = collectVideoUrls(props)
    expect(urls).toEqual([])
  })

  it("extracts video URLs from legacy mediaAssets", () => {
    const props = {
      mediaAssets: [
        { src: "https://cdn.example.com/v.mp4", type: "video" },
        { src: "https://cdn.example.com/img.png", type: "image" },
      ],
    }
    const urls = collectVideoUrls(props)
    expect(urls).toEqual(["https://cdn.example.com/v.mp4"])
  })

  it("returns empty array for no-video props", () => {
    expect(collectVideoUrls({})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// replaceVideoUrls
// ---------------------------------------------------------------------------

describe("replaceVideoUrls", () => {
  it("replaces URLs in scene graph segments", () => {
    const props = {
      sceneGraph: {
        tracks: [
          { type: "media", segments: [{ mediaType: "video", src: "https://cdn.example.com/v.mp4" }] },
        ],
      },
    }
    const urlMap = new Map([["https://cdn.example.com/v.mp4", "http://localhost:9999/norm-123.mp4"]])
    replaceVideoUrls(props, urlMap)

    const seg = (props.sceneGraph.tracks[0] as { segments: Array<{ src: string }> }).segments[0]
    expect(seg.src).toBe("http://localhost:9999/norm-123.mp4")
  })

  it("replaces sourceVideo and layer URLs in plan", () => {
    const props = {
      plan: {
        sourceVideo: "https://cdn.example.com/source.mp4",
        layers: [{ sourceVideo: "https://cdn.example.com/layer.mp4" }],
      },
    }
    const urlMap = new Map([
      ["https://cdn.example.com/source.mp4", "http://localhost:9999/norm-1.mp4"],
      ["https://cdn.example.com/layer.mp4", "http://localhost:9999/norm-2.mp4"],
    ])
    replaceVideoUrls(props, urlMap)

    expect(props.plan.sourceVideo).toBe("http://localhost:9999/norm-1.mp4")
    expect((props.plan.layers as Array<{ sourceVideo: string }>)[0].sourceVideo).toBe("http://localhost:9999/norm-2.mp4")
  })

  it("replaces backgroundMedia URL in plan", () => {
    const props = {
      plan: {
        backgroundMedia: "https://cdn.example.com/bg.mp4",
      },
    }
    const urlMap = new Map([["https://cdn.example.com/bg.mp4", "http://localhost:9999/norm-bg.mp4"]])
    replaceVideoUrls(props, urlMap)
    expect(props.plan.backgroundMedia).toBe("http://localhost:9999/norm-bg.mp4")
  })

  it("replaces URLs in legacy mediaAssets", () => {
    const props = {
      mediaAssets: [
        { src: "https://cdn.example.com/v.mp4", type: "video" },
        { src: "https://cdn.example.com/img.png", type: "image" },
      ],
    }
    const urlMap = new Map([["https://cdn.example.com/v.mp4", "http://localhost:9999/norm-v.mp4"]])
    replaceVideoUrls(props, urlMap)

    expect(props.mediaAssets[0].src).toBe("http://localhost:9999/norm-v.mp4")
    expect(props.mediaAssets[1].src).toBe("https://cdn.example.com/img.png") // unchanged
  })

  it("does nothing when URL is not in map", () => {
    const props = {
      sceneGraph: {
        tracks: [
          { type: "media", segments: [{ mediaType: "video", src: "https://cdn.example.com/other.mp4" }] },
        ],
      },
    }
    const urlMap = new Map([["https://cdn.example.com/v.mp4", "http://localhost:9999/norm.mp4"]])
    replaceVideoUrls(props, urlMap)

    const seg = (props.sceneGraph.tracks[0] as { segments: Array<{ src: string }> }).segments[0]
    expect(seg.src).toBe("https://cdn.example.com/other.mp4")
  })
})
