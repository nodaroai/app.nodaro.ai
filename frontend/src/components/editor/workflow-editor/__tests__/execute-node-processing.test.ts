import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock variables (declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
const mockResolveNodeInputs = vi.fn()
const mockExtractNodeOutput = vi.fn()
const mockCollectMediaAssets = vi.fn()
const mockBuildAutoComposition = vi.fn()
const mockCollectAncestorRefs = vi.fn()
const mockRunImageGeneration = vi.fn()
const mockRunEditImage = vi.fn()
const mockRunImageToImage = vi.fn()
const mockRunVideoGeneration = vi.fn()
const mockRunVideoToVideoGeneration = vi.fn()
const mockRunTextToVideoGeneration = vi.fn()
const mockRunTextToSpeechGeneration = vi.fn()
const mockRunScriptGeneration = vi.fn()
const mockRunCombineVideos = vi.fn()
const mockRunCharacterGeneration = vi.fn()
const mockRunFaceGeneration = vi.fn()
const mockRunObjectGeneration = vi.fn()
const mockRunLocationGeneration = vi.fn()
const mockPollJobWithNodeUpdate = vi.fn()
const mockGenerateSceneGraph = vi.fn()
const mockGenerateAfterEffects = vi.fn()
const mockGenerateLottieOverlay = vi.fn()
const mockGenerate3DTitle = vi.fn()
const mockGenerateMotionGraphics = vi.fn()
const mockRenderVideoWithSceneGraph = vi.fn()
const mockRenderVideoWithPlan = vi.fn()
const mockGenerateAIWriterStream = vi.fn()
const mockImageToTextApi = vi.fn()
const mockLipSyncApi = vi.fn()
const mockMotionTransferApi = vi.fn()
const mockVideoUpscaleApi = vi.fn()
const mockMergeVideoAudioApi = vi.fn()
const mockTrimAudioApi = vi.fn()
const mockTrimVideoApi = vi.fn()
const mockTranscodeVideoApi = vi.fn()
const mockSpeedRampApi = vi.fn()
const mockLoopVideoApi = vi.fn()
const mockFadeVideoApi = vi.fn()
const mockVideoOverlayApi = vi.fn()
const mockResizeVideoApi = vi.fn()
const mockAdjustVolumeApi = vi.fn()
const mockAddCaptionsApi = vi.fn()
const mockMixAudioApi = vi.fn()
const mockSpeechToVideoApi = vi.fn()
const mockVoiceChangerProApi = vi.fn()
const mockVoiceChangerApi = vi.fn()
const mockImageCollageApi = vi.fn()
const mockTranscribeApi = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []
let mockCharacterDefinitions: any[] = []

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      updateNodeData: mockUpdateNodeData,
      nodes: mockNodes,
      edges: mockEdges,
      characterDefinitions: mockCharacterDefinitions,
      userPromptTemplates: {},
      flowPromptTemplates: {},
    }),
  },
}))

vi.mock("@/lib/api", () => ({
  generateImage: vi.fn(),
  getJobStatusLean: vi.fn(),
  generateAIWriterStream: (...args: unknown[]) =>
    mockGenerateAIWriterStream(...args),
  generateSceneGraph: (...args: unknown[]) =>
    mockGenerateSceneGraph(...args),
  generateAfterEffects: (...args: unknown[]) =>
    mockGenerateAfterEffects(...args),
  generateLottieOverlay: (...args: unknown[]) =>
    mockGenerateLottieOverlay(...args),
  generate3DTitle: (...args: unknown[]) => mockGenerate3DTitle(...args),
  generateMotionGraphics: (...args: unknown[]) =>
    mockGenerateMotionGraphics(...args),
  renderVideoWithSceneGraph: (...args: unknown[]) =>
    mockRenderVideoWithSceneGraph(...args),
  renderVideoWithPlan: (...args: unknown[]) =>
    mockRenderVideoWithPlan(...args),
  imageToTextApi: (...args: unknown[]) => mockImageToTextApi(...args),
  generateMusicApi: vi.fn(),
  textToAudioApi: vi.fn(),
  audioIsolationApi: vi.fn(),
  sunoGenerateApi: vi.fn(),
  sunoCoverApi: vi.fn(),
  sunoExtendApi: vi.fn(),
  sunoLyricsApi: vi.fn(),
  sunoSeparateApi: vi.fn(),
  sunoMusicVideoApi: vi.fn(),
  sunoMashupApi: vi.fn(),
  sunoReplaceSectionApi: vi.fn(),
  sunoStyleBoostApi: vi.fn(),
  sunoAddInstrumentalApi: vi.fn(),
  sunoAddVocalsApi: vi.fn(),
  sunoConvertWavApi: vi.fn(),
  sunoUploadExtendApi: vi.fn(),
  transcribeApi: (...args: unknown[]) => mockTranscribeApi(...args),
  downloadYouTubeAudio: vi.fn(),
  lipSyncApi: (...args: unknown[]) => mockLipSyncApi(...args),
  motionTransferApi: (...args: unknown[]) => mockMotionTransferApi(...args),
  videoUpscaleApi: (...args: unknown[]) => mockVideoUpscaleApi(...args),
  mergeVideoAudioApi: (...args: unknown[]) =>
    mockMergeVideoAudioApi(...args),
  trimAudioApi: (...args: unknown[]) => mockTrimAudioApi(...args),
  trimVideoApi: (...args: unknown[]) => mockTrimVideoApi(...args),
  transcodeVideoApi: (...args: unknown[]) => mockTranscodeVideoApi(...args),
  speedRampApi: (...args: unknown[]) => mockSpeedRampApi(...args),
  loopVideoApi: (...args: unknown[]) => mockLoopVideoApi(...args),
  fadeVideoApi: (...args: unknown[]) => mockFadeVideoApi(...args),
  videoOverlayApi: (...args: unknown[]) => mockVideoOverlayApi(...args),
  resizeVideoApi: (...args: unknown[]) => mockResizeVideoApi(...args),
  adjustVolumeApi: (...args: unknown[]) => mockAdjustVolumeApi(...args),
  addCaptionsApi: (...args: unknown[]) => mockAddCaptionsApi(...args),
  mixAudioApi: (...args: unknown[]) => mockMixAudioApi(...args),
  speechToVideoApi: (...args: unknown[]) => mockSpeechToVideoApi(...args),
  voiceChangerProApi: (...args: unknown[]) => mockVoiceChangerProApi(...args),
  voiceChangerApi: (...args: unknown[]) => mockVoiceChangerApi(...args),
  imageCollageApi: (...args: unknown[]) => mockImageCollageApi(...args),
  combineVideos: vi.fn(),
  editImage: vi.fn(),
  imageToImage: vi.fn(),
  generateVideo: vi.fn(),
  videoToVideo: vi.fn(),
  textToVideo: vi.fn(),
  textToSpeech: vi.fn(),
  generateScriptApi: vi.fn(),
  setForcePrivate: vi.fn(),
  setCurrentNodeId: vi.fn(),
  setUserPromptTemplate: vi.fn(),
}))

vi.mock("@/lib/prompt-templates", () => ({
  resolveTemplate: () => "{{userPrompt}} {{assetDescriptions}}",
  applyTemplate: (t: string, vars: Record<string, string>) => {
    let result = t
    for (const [k, v] of Object.entries(vars))
      result = result.replace(`{{${k}}}`, v)
    return result
  },
}))

vi.mock("@/lib/generate-text-templates", () => ({
  getGenerateTextTemplate: () => null,
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: () => "scene prompt",
}))

vi.mock("../node-input-resolver", () => ({
  resolveNodeInputs: (...args: unknown[]) => mockResolveNodeInputs(...args),
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: (...args: unknown[]) => mockExtractNodeOutput(...args),
  detectPreviewItemType: (_nodeType: string, value?: string) => {
    if (!value) return "text"
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(value)) return "image"
    if (/\.(mp4|mov|webm)$/i.test(value)) return "video"
    if (/\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(value)) return "audio"
    return "text"
  },
  collectMediaAssets: (...args: unknown[]) => mockCollectMediaAssets(...args),
  buildAutoComposition: (...args: unknown[]) =>
    mockBuildAutoComposition(...args),
  collectAncestorRefs: (...args: unknown[]) =>
    mockCollectAncestorRefs(...args),
}))

vi.mock("../poll-job", () => ({
  // The run-start reset every executor spreads — mirrors ./poll-job's constant
  // (whose key set is pinned by run-start-reset.test.ts).
  RUN_START_RESET: {
    executionStatus: "running",
    errorMessage: undefined,
    errorHint: undefined,
    currentJobId: undefined,
    currentJobProgress: 0,
    jobAwaitingReview: undefined,
  },
  pollJobWithNodeUpdate: (...args: unknown[]) =>
    mockPollJobWithNodeUpdate(...args),
  setSuppressToasts: () => {},
  guardedToast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock("../node-executors", () => ({
  runImageGeneration: (...args: unknown[]) =>
    mockRunImageGeneration(...args),
  runEditImage: (...args: unknown[]) => mockRunEditImage(...args),
  runImageToImage: (...args: unknown[]) => mockRunImageToImage(...args),
  runVideoGeneration: (...args: unknown[]) =>
    mockRunVideoGeneration(...args),
  runVideoToVideoGeneration: (...args: unknown[]) =>
    mockRunVideoToVideoGeneration(...args),
  runTextToVideoGeneration: (...args: unknown[]) =>
    mockRunTextToVideoGeneration(...args),
  runTextToSpeechGeneration: (...args: unknown[]) =>
    mockRunTextToSpeechGeneration(...args),
  runScriptGeneration: (...args: unknown[]) =>
    mockRunScriptGeneration(...args),
  runCombineVideos: (...args: unknown[]) => mockRunCombineVideos(...args),
}))

vi.mock("../asset-executors", () => ({
  runCharacterGeneration: (...args: unknown[]) =>
    mockRunCharacterGeneration(...args),
  runFaceGeneration: (...args: unknown[]) =>
    mockRunFaceGeneration(...args),
  runObjectGeneration: (...args: unknown[]) =>
    mockRunObjectGeneration(...args),
  runLocationGeneration: (...args: unknown[]) =>
    mockRunLocationGeneration(...args),
}))

vi.mock("../types", () => ({
  WorkflowStaleError: class extends Error {
    constructor() {
      super("stale")
    }
  },
  MAX_CONSECUTIVE_POLL_FAILURES: 3,
  checkStorageError: () => false,
}))

// ---------------------------------------------------------------------------
// Import AFTER all mocks
// ---------------------------------------------------------------------------

import { executeNode } from "../execute-node"
import { DEFAULT_VIDEO_OVERLAY_LAYER, VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH, expandVideoOverlayLayer, videoOverlayCompositionKey, videoOverlaySlotSources } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: any = {}) {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: any) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    ...overrides,
  } as any
}

function makeNode(type: string, data: any = {}) {
  return {
    id: "n1",
    type,
    position: { x: 0, y: 0 },
    data: { label: type, ...data },
  } as any
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = []
  mockEdges = []
  mockCharacterDefinitions = []
  mockResolveNodeInputs.mockReturnValue({})
  mockCollectAncestorRefs.mockReturnValue([])
})

// ---------------------------------------------------------------------------
// lip-sync
// ---------------------------------------------------------------------------

describe("lip-sync", () => {
  it("rejects when no portrait image found", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    const promise = executeNode(
      makeNode("lip-sync", { provider: "kling-avatar" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No portrait image")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no audio track found", async () => {
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://img.png" })
    const promise = executeNode(
      makeNode("lip-sync", { provider: "kling-avatar" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio track")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls lipSyncApi with correct args via pollJobWithNodeUpdate", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://portrait.png",
      audioUrl: "http://voice.mp3",
    })
    mockLipSyncApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("lip-sync", {
        provider: "kling-avatar",
        resolution: "720p",
        prompt: "A person talking naturally",
        // Cached value bypasses probeAudioDuration() — jsdom can't decode
        // audio metadata so an un-cached call hangs the test on the
        // loadedmetadata event (8s internal timeout > 5s vitest timeout).
        audioDurationSec: 15,
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Lip Sync",
      expect.anything(),
      undefined,
    )
    // Invoke the api call function to verify lipSyncApi args
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockLipSyncApi).toHaveBeenCalledWith(
      "http://portrait.png",
      "http://voice.mp3",
      "A person talking naturally",
      "kling-avatar",
      "720p",
      "u1",
      {
        videoUrl: undefined,
        audioDurationSec: 15,
        guidanceScale: undefined,
        inferenceSteps: undefined,
        seed: undefined,
        pads: undefined,
        smooth: undefined,
        fps: undefined,
        resizeFactor: undefined,
        enhancer: undefined,
        preprocess: undefined,
        still: undefined,
        poseStyle: undefined,
        expressionScale: undefined,
      },
    )
  })
})

// ---------------------------------------------------------------------------
// motion-transfer
// ---------------------------------------------------------------------------

describe("motion-transfer", () => {
  it("rejects when no character image found", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue(undefined)
    const promise = executeNode(
      makeNode("motion-transfer", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No character image")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no motion video found", async () => {
    // Provide an image source but no video source
    const imageNode = {
      id: "img1",
      type: "generate-image",
      data: { label: "Img" },
    }
    mockNodes = [makeNode("motion-transfer", {}), imageNode]
    mockEdges = [{ id: "e1", source: "img1", target: "n1" }]
    mockExtractNodeOutput.mockReturnValue("http://img.png")
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://img.png" })
    const promise = executeNode(
      makeNode("motion-transfer", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No motion video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls motionTransferApi with correct args when both inputs are present", async () => {
    const imageNode = {
      id: "img1",
      type: "generate-image",
      data: { label: "Img" },
    }
    const videoNode = {
      id: "vid1",
      type: "image-to-video",
      data: { label: "Vid" },
    }
    mockNodes = [makeNode("motion-transfer", {}), imageNode, videoNode]
    mockEdges = [
      { id: "e1", source: "img1", target: "n1" },
      { id: "e2", source: "vid1", target: "n1" },
    ]
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.id === "img1") return "http://character.png"
      if (node.id === "vid1") return "http://motion.mp4"
      return undefined
    })
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://character.png", videoUrl: "http://motion.mp4" })
    mockMotionTransferApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("motion-transfer", {
        prompt: "dancing",
        characterOrientation: "front",
        resolution: "1080p",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Motion Transfer",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockMotionTransferApi).toHaveBeenCalledWith(
      "http://character.png",
      "http://motion.mp4",
      "dancing",
      "front",
      "1080p",
      "u1",
      undefined,
      undefined,
      undefined,
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// video-upscale
// ---------------------------------------------------------------------------

describe("video-upscale", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("video-upscale", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls videoUpscaleApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://low-res.mp4",
    })
    mockVideoUpscaleApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("video-upscale", { upscaleFactor: 2 }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Upscale Video",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockVideoUpscaleApi).toHaveBeenCalledWith({
      videoUrl: "http://low-res.mp4",
      upscaleFactor: 2,
      userId: "u1",
      provider: "topaz",
    })
  })

  it("passes undefined upscaleFactor when not set", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://video.mp4",
    })
    mockVideoUpscaleApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("video-upscale", {}), makeCtx())
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockVideoUpscaleApi).toHaveBeenCalledWith({
      videoUrl: "http://video.mp4",
      upscaleFactor: undefined,
      userId: "u1",
      provider: "topaz",
    })
  })
})

// ---------------------------------------------------------------------------
// merge-video-audio
// ---------------------------------------------------------------------------

describe("merge-video-audio", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioSources: [{ url: "http://a.mp3", sourceNodeId: "s1" }],
    })
    const promise = executeNode(
      makeNode("merge-video-audio", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
      audioSources: [],
    })
    const promise = executeNode(
      makeNode("merge-video-audio", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls mergeVideoAudioApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
      audioSources: [
        { url: "http://voice.mp3", sourceNodeId: "s1", sourceType: "audio" },
      ],
    })
    mockMergeVideoAudioApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("merge-video-audio", {
        keepOriginalAudio: true,
        backgroundVolume: 50,
      }),
      makeCtx(),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockMergeVideoAudioApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      [
        {
          url: "http://voice.mp3",
          startTime: 0,
          volume: 100,
          sourceType: "audio",
        },
      ],
      50,
      true,
      "u1",
    )
  })
})

// ---------------------------------------------------------------------------
// trim-audio
// ---------------------------------------------------------------------------

describe("trim-audio", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("trim-audio", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls trimAudioApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockTrimAudioApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("trim-audio", {
        audioFormat: "mp3",
        outputSilentVideo: true,
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Trim Audio",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockTrimAudioApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      "mp3",
      "u1",
      undefined,
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// trim-video
// ---------------------------------------------------------------------------

describe("trim-video", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("trim-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls trimVideoApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockTrimVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("trim-video", { startTime: 5, endTime: 15 }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Trim Video",
      expect.anything(),
      expect.any(Function),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockTrimVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      5,
      15,
      "u1",
      undefined,
      {
        trimStartFrames: undefined,
        trimEndFrames: undefined,
        smartLoopCut: false,
        smartLoopCutLookback: undefined,
        trimMode: "time",
        upstreamDuration: undefined,
      },
    )
  })

  it("passes undefined endTime when not set", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockTrimVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("trim-video", { startTime: 2 }),
      makeCtx(),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockTrimVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      2,
      undefined,
      "u1",
      undefined,
      {
        trimStartFrames: undefined,
        trimEndFrames: undefined,
        smartLoopCut: false,
        smartLoopCutLookback: undefined,
        trimMode: "time",
        upstreamDuration: undefined,
      },
    )
  })
})

// ---------------------------------------------------------------------------
// transcode-video
// ---------------------------------------------------------------------------

describe("transcode-video", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("transcode-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls transcodeVideoApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockTranscodeVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("transcode-video", {
        codec: "h265",
        crf: 23,
        resolution: "1080p",
        audioBitrate: "192k",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Transcode Video",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockTranscodeVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      "h265",
      23,
      "1080p",
      "192k",
      "u1",
    )
  })

  it("passes undefined for optional transcode fields", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockTranscodeVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("transcode-video", {}), makeCtx())
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockTranscodeVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      undefined,
      undefined,
      undefined,
      undefined,
      "u1",
    )
  })
})

// ---------------------------------------------------------------------------
// speed-ramp
// ---------------------------------------------------------------------------

describe("speed-ramp", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("speed-ramp", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls speedRampApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockSpeedRampApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("speed-ramp", { speed: 2.0, adjustAudio: true }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Adjust Speed",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockSpeedRampApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      2.0,
      true,
      "u1",
      {
        reverse: undefined,
        audioMode: undefined,
        quality: undefined,
        ramps: undefined,
      },
    )
  })
})

// ---------------------------------------------------------------------------
// loop-video
// ---------------------------------------------------------------------------

describe("loop-video", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("loop-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls loopVideoApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockLoopVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("loop-video", {
        mode: "repeat",
        repeatCount: 3,
        targetDuration: 30,
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Loop Video",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockLoopVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      "repeat",
      3,
      30,
      "u1",
      {
        smartLoopCutBeforeRepeat: undefined,
        smartLoopCutLookback: undefined,
      },
    )
  })

  it("defaults mode to repeat when not set", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockLoopVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("loop-video", {}), makeCtx())
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockLoopVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      "repeat",
      undefined,
      undefined,
      "u1",
      {
        smartLoopCutBeforeRepeat: undefined,
        smartLoopCutLookback: undefined,
      },
    )
  })
})

// ---------------------------------------------------------------------------
// fade-video
// ---------------------------------------------------------------------------

describe("fade-video", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("fade-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls fadeVideoApi with correct args and defaults", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockFadeVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("fade-video", {
        fadeIn: true,
        fadeInDuration: 1.0,
        fadeOut: true,
        fadeOutDuration: 2.0,
        color: "white",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Fade In/Out",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockFadeVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      true,
      1.0,
      true,
      2.0,
      "white",
      "u1",
    )
  })

  it("uses default values when fade options are not set", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockFadeVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("fade-video", {}), makeCtx())
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    // fadeIn defaults to true (undefined !== false), fadeOut defaults to true,
    // durations default to 0.5, color defaults to "black"
    expect(mockFadeVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      true,
      0.5,
      true,
      0.5,
      "black",
      "u1",
    )
  })
})

// ---------------------------------------------------------------------------
// resize-video
// ---------------------------------------------------------------------------

describe("resize-video", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("resize-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls resizeVideoApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockResizeVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("resize-video", {
        targetAspect: "9:16",
        method: "pad",
        padColor: "#000000",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Resize Video",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockResizeVideoApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      "9:16",
      "pad",
      "#000000",
      "u1",
    )
  })
})

// ---------------------------------------------------------------------------
// adjust-volume
// ---------------------------------------------------------------------------

describe("adjust-volume", () => {
  it("rejects when no audio or video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("adjust-volume", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls adjustVolumeApi with audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrl: "http://audio.mp3",
    })
    mockAdjustVolumeApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("adjust-volume", {
        volume: 150,
        normalize: true,
        fadeIn: 0.5,
        fadeOut: 1.0,
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Adjust Volume",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockAdjustVolumeApi).toHaveBeenCalledWith(
      "http://audio.mp3",
      "audio",
      150,
      true,
      0.5,
      1.0,
      "u1",
    )
  })

  it("uses generatedVideoUrl output key when video input is provided", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockAdjustVolumeApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("adjust-volume", { volume: 80 }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Adjust Volume",
      expect.anything(),
      undefined,
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", {
      lastInputType: "video",
    })
  })
})

// ---------------------------------------------------------------------------
// add-captions
// ---------------------------------------------------------------------------

describe("add-captions", () => {
  it("rejects when no video input", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "some text" })
    const promise = executeNode(
      makeNode("add-captions", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  // #759: no text is the NORMAL auto-transcribe request (opt-out, worker
  // semantics) — a bare video must run, and the api call must OMIT the empty
  // text so the route's min(1) schema doesn't reject it.
  it("runs from a bare video with no caption text — auto-transcribe default", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", {}),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("rejects only when auto-transcribe is explicitly OFF and no text exists", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    const promise = executeNode(
      makeNode("add-captions", { autoTranscribe: false }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No caption source")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls addCaptionsApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
      prompt: "Hello World",
    })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", {
        style: "outline",
        position: "bottom",
        fontSize: 24,
        color: "#FFFFFF",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Add Captions",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockAddCaptionsApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      "Hello World",
      "outline",
      "bottom",
      24,
      "#FFFFFF",
      undefined,
      "u1",
      { autoTranscribe: undefined, transcribeProvider: undefined },
    )
  })

  it("proceeds without manual text when autoTranscribe is enabled (matches DAG)", async () => {
    // Kinetic factory presets set autoTranscribe:true with no manual text. The
    // single-node path used to reject "No text" here while the workflow/DAG path
    // auto-transcribed the video — this locks in the parity fix.
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", {
        autoTranscribe: true,
        transcribeProvider: "whisper",
        style: "word-pop",
      }),
      makeCtx(),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockAddCaptionsApi).toHaveBeenCalledWith(
      "http://vid.mp4",
      "",
      "word-pop",
      undefined,
      undefined,
      undefined,
      undefined,
      "u1",
      { autoTranscribe: true, transcribeProvider: "whisper" },
    )
  })

  // The node's OWN `text` is a real authored field (the DAG engine reads
  // `resolvedInputs.prompt || data.text`), but the canvas panel has no text
  // control, so reading only `inputs.prompt` silently dropped the caption an
  // import / agent / MCP write had authored and auto-transcribed instead.
  it("burns the node's own text when nothing is wired — the DAG engine's precedence", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", { style: "subtitle", text: "SALE ENDS FRIDAY" }),
      makeCtx(),
    )
    await mockPollJobWithNodeUpdate.mock.calls[0][1]()
    expect(mockAddCaptionsApi.mock.calls[0][1]).toBe("SALE ENDS FRIDAY")
  })

  it("wired text still wins over the node's own text", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4", prompt: "from the wire" })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", { style: "subtitle", text: "from the node" }),
      makeCtx(),
    )
    await mockPollJobWithNodeUpdate.mock.calls[0][1]()
    expect(mockAddCaptionsApi.mock.calls[0][1]).toBe("from the wire")
  })

  it("its own text is a caption source, so auto-transcribe OFF is runnable", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", { autoTranscribe: false, text: "Hello" }),
      makeCtx(),
    )
    expect(mockToastError).not.toHaveBeenCalled()
  })

  // A wired transcript is a caption source in the route's own superRefine, so
  // the canvas guard must not refuse it either.
  it("a wired transcript is a caption source with auto-transcribe OFF", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4", transcript: '{"words":[]}' })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", { autoTranscribe: false }),
      makeCtx(),
    )
    expect(mockToastError).not.toHaveBeenCalled()
  })

  // Node data that never passed the panel's clamp (agent / import / template)
  // reaches this engine raw: a fontSize the route's Zod 400s on, and a `null`
  // lever the render plan rejects mid-run. Both are coerced with the SAME helper
  // the orchestrator applies, so one node cannot mean two things.
  it("coerces the numeric levers the way the DAG engine does — never sends an out-of-range or null one", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", {
        style: "subtitle",
        text: "Hi",
        fontSize: 10,
        fontWeight: 340,
        maxWordsPerLine: 99,
        positionY: null,
      }),
      makeCtx(),
    )
    await mockPollJobWithNodeUpdate.mock.calls[0][1]()
    const call = mockAddCaptionsApi.mock.calls[0]
    expect(call[4]).toBe(12)
    expect(call[8].fontWeight).toBe(300)
    expect(call[8].maxWordsPerLine).toBe(20)
    expect(call[8].positionY).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// transcribe — word timings
// ---------------------------------------------------------------------------

/**
 * A lane that cannot return per-word timings still RUNS and BILLS, handing back
 * `words: []`. An EXPLICIT `wordTimestamps: true` on such a lane is therefore a
 * promise the run cannot keep, and is refused BEFORE the API call. The INFERRED
 * request (a wired `json` handle) stays capability-aware: it degrades to a
 * segments-only transcript instead of refusing.
 */
describe("transcribe word timings", () => {
  it("refuses an explicit wordTimestamps request on whisper, before the API call", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://a.mp3" })
    const promise = executeNode(
      makeNode("transcribe", { label: "My Transcribe", provider: "whisper", wordTimestamps: true }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Word timings unavailable")
    expect(mockTranscribeApi).not.toHaveBeenCalled()
    // Nothing flips to running either — the refusal lands before RUN_START_RESET.
    expect(mockUpdateNodeData).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("My Transcribe"))
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("whisper"))
  })

  it("runs the same request on a word-capable lane", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://a.mp3" })
    mockTranscribeApi.mockResolvedValue({ jobId: "j1" })
    const promise = executeNode(
      makeNode("transcribe", { provider: "incredibly-fast-whisper", wordTimestamps: true }),
      makeCtx(),
    )
    promise.catch(() => {})
    await vi.waitFor(() => expect(mockTranscribeApi).toHaveBeenCalled())
    expect(mockTranscribeApi.mock.calls[0][6]).toBe(true)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("does not refuse an INFERRED request on whisper — it degrades instead", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://a.mp3" })
    mockTranscribeApi.mockResolvedValue({ jobId: "j1" })
    mockEdges = [{ id: "e1", source: "n1", target: "c1", sourceHandle: "json", targetHandle: "transcript" }]
    const promise = executeNode(
      makeNode("transcribe", { provider: "whisper" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await vi.waitFor(() => expect(mockTranscribeApi).toHaveBeenCalled())
    // The wired json handle asked for words; the lane can't, so the flag goes
    // out false rather than refusing the run.
    expect(mockTranscribeApi.mock.calls[0][6]).toBe(false)
    expect(mockToastError).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// mix-audio
// ---------------------------------------------------------------------------

describe("mix-audio", () => {
  it("rejects when fewer than 2 audio inputs", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrls: ["http://a.mp3"],
    })
    const promise = executeNode(
      makeNode("mix-audio", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Need at least 2 audio tracks")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls mixAudioApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrls: ["http://a.mp3", "http://b.mp3"],
      audioUrlsWithSourceIds: [
        { nodeId: "s1", url: "http://a.mp3" },
        { nodeId: "s2", url: "http://b.mp3" },
      ],
    })
    mockMixAudioApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("mix-audio", {
        trackVolumes: { s1: 80, s2: 120 },
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Mix Audio",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockMixAudioApi).toHaveBeenCalledWith(
      ["http://a.mp3", "http://b.mp3"],
      [80, 120],
      "u1",
    )
  })

  it("defaults track volumes to 100 when not specified", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrls: ["http://a.mp3", "http://b.mp3"],
      audioUrlsWithSourceIds: [
        { nodeId: "s1", url: "http://a.mp3" },
        { nodeId: "s2", url: "http://b.mp3" },
      ],
    })
    mockMixAudioApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("mix-audio", {}), makeCtx())
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockMixAudioApi).toHaveBeenCalledWith(
      ["http://a.mp3", "http://b.mp3"],
      [100, 100],
      "u1",
    )
  })
})

// ---------------------------------------------------------------------------
// speech-to-video
// ---------------------------------------------------------------------------

describe("speech-to-video", () => {
  it("rejects when no image input", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    const promise = executeNode(
      makeNode("speech-to-video", { prompt: "talking" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No image input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no audio track", async () => {
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://img.png" })
    const promise = executeNode(
      makeNode("speech-to-video", { prompt: "talking" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio track")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://img.png",
      audioUrl: "http://audio.mp3",
    })
    const promise = executeNode(
      makeNode("speech-to-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls speechToVideoApi with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://portrait.png",
      audioUrl: "http://voice.mp3",
      prompt: "A person speaking",
    })
    mockSpeechToVideoApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("speech-to-video", {
        prompt: "A person speaking",
        resolution: "720p",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Speech to Video",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockSpeechToVideoApi).toHaveBeenCalledWith({
      imageUrl: "http://portrait.png",
      audioUrl: "http://voice.mp3",
      prompt: "A person speaking",
      resolution: "720p",
      negativePrompt: undefined,
      seed: undefined,
      numFrames: undefined,
      fps: undefined,
      inferenceSteps: undefined,
      guidanceScale: undefined,
      shift: undefined,
      userId: "u1",
    })
  })
})

// ---------------------------------------------------------------------------
// voice-changer (legacy single-voice node)
// ---------------------------------------------------------------------------

describe("voice-changer", () => {
  // Same media-typed completion as voice-changer-pro: the backend demotes an
  // audio-only "video" to audio output, so the video-wired dispatch must poll
  // with a key LIST or a completed (and charged) job paints "No output URL".
  it("video input wired → polls with a media-typed key list (video first, audio fallback)", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://clip.mp4" })
    mockVoiceChangerApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("voice-changer", { voiceId: "v1" }), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      ["generatedVideoUrl", "generatedAudioUrl"],
      "Voice Changer",
      expect.anything(),
      expect.any(Function),
    )
  })

  it("audio input wired → polls the audio key only (unchanged)", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://in.mp3" })
    mockVoiceChangerApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("voice-changer", { voiceId: "v1" }), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1", expect.any(Function), "generatedAudioUrl", "Voice Changer", expect.anything(), undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// voice-changer-pro
// ---------------------------------------------------------------------------

describe("voice-changer-pro", () => {
  it("rejects when no audio or video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("voice-changer-pro", { orderedVoices: [{ voiceId: "v1" }] }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no voices configured", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    const promise = executeNode(
      makeNode("voice-changer-pro", { orderedVoices: [] }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No voices")
    expect(mockToastError).toHaveBeenCalled()
  })

  // Keep-slot: a null entry means "keep this speaker's original voice"
  // (cloud-plugins orderedVoices contract). The per-voice settings map must
  // preserve it positionally instead of crashing on `v.voiceId`.
  it("calls voiceChangerProApi with a null keep-original slot preserved positionally", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    mockVoiceChangerProApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("voice-changer-pro", {
        orderedVoices: [null, { voiceId: "v2", stability: 0.8 }],
        preserveBackground: true,
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Voice Changer Pro",
      expect.anything(),
      undefined,
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockVoiceChangerProApi).toHaveBeenCalledWith(
      "http://audio.mp3",
      [null, { voiceId: "v2", stability: 0.8 }],
      "u1",
      undefined,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    )
  })

  // The backend decides audio-vs-video from the media's ACTUAL streams: a
  // video-wired run can legitimately deliver audio (an audio-only .mp4 has no
  // video to remux onto). The poller therefore gets an ordered key LIST —
  // video first, audio as the fallback — instead of a single static key.
  it("video input wired → polls with a media-typed key list (video first, audio fallback)", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://clip.mp4" })
    mockVoiceChangerProApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("voice-changer-pro", { orderedVoices: [{ voiceId: "v1" }] }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      ["generatedVideoUrl", "generatedAudioUrl"],
      "Voice Changer Pro",
      expect.anything(),
      expect.any(Function),
    )
  })

  it("rejects when every slot is a keep-slot (all-null orderedVoices)", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    const promise = executeNode(
      makeNode("voice-changer-pro", { orderedVoices: [null, null] }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No recast voices")
    expect(mockToastError).toHaveBeenCalled()
    expect(mockVoiceChangerProApi).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// motion-transfer with kling-3.0 provider
// ---------------------------------------------------------------------------

describe("motion-transfer with kling-3.0 provider", () => {
  it("passes provider and backgroundSource to motionTransferApi", async () => {
    const imageNode = {
      id: "img1",
      type: "generate-image",
      data: { label: "Img" },
    }
    const videoNode = {
      id: "vid1",
      type: "image-to-video",
      data: { label: "Vid" },
    }
    mockNodes = [makeNode("motion-transfer", {}), imageNode, videoNode]
    mockEdges = [
      { id: "e1", source: "img1", target: "n1" },
      { id: "e2", source: "vid1", target: "n1" },
    ]
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.id === "img1") return "http://character.png"
      if (node.id === "vid1") return "http://motion.mp4"
      return undefined
    })
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://character.png", videoUrl: "http://motion.mp4" })
    mockMotionTransferApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("motion-transfer", {
        prompt: "dancing",
        characterOrientation: "front",
        resolution: "1080p",
        provider: "kling-3.0",
        backgroundSource: "greenscreen",
      }),
      makeCtx(),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockMotionTransferApi).toHaveBeenCalledWith(
      "http://character.png",
      "http://motion.mp4",
      "dancing",
      "front",
      "1080p",
      "u1",
      "kling-3.0",
      "greenscreen",
      undefined,
      undefined,
    )
  })
})


// ---------------------------------------------------------------------------
// image-collage — numbered + per-source label alignment (mirrors imageSizes)
// ---------------------------------------------------------------------------

describe("image-collage", () => {
  // Two sources: A contributes one image, B (a List) contributes two. Labels
  // are keyed by SOURCE NODE ID and must follow the wire order (incl. imageOrder
  // reorder) and duplicate a List source's label onto every image it contributes.
  const withSourceIds = [
    { nodeId: "A", url: "http://a.png" },
    { nodeId: "B", url: "http://b1.png" },
    { nodeId: "B", url: "http://b2.png" },
  ]

  async function runCollage(data: Record<string, unknown>) {
    mockResolveNodeInputs.mockReturnValue({
      imageUrls: withSourceIds.map((e) => e.url),
      imageUrlsWithSourceIds: withSourceIds,
    })
    mockImageCollageApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("image-collage", data), makeCtx())
    const calls = mockPollJobWithNodeUpdate.mock.calls
    const apiCallFn = calls[calls.length - 1][1]
    await apiCallFn()
    const collageCalls = mockImageCollageApi.mock.calls
    return collageCalls[collageCalls.length - 1]
  }

  it("aligns per-source labels to the wire order and duplicates a List label", async () => {
    const [urls, opts] = await runCollage({
      imageLabelBySource: { A: "Wide", B: "Close-up" },
    })
    expect(urls).toEqual(["http://a.png", "http://b1.png", "http://b2.png"])
    expect(opts.imageLabels).toEqual(["Wide", "Close-up", "Close-up"])
  })

  it("labels follow the imageOrder reorder", async () => {
    const [urls, opts] = await runCollage({
      imageOrder: ["B", "A"],
      imageLabelBySource: { A: "Wide", B: "Close-up" },
    })
    expect(urls).toEqual(["http://b1.png", "http://b2.png", "http://a.png"])
    expect(opts.imageLabels).toEqual(["Close-up", "Close-up", "Wide"])
  })

  it("passes numbered through only when true", async () => {
    const [, on] = await runCollage({ numbered: true })
    expect(on.numbered).toBe(true)
    const [, off] = await runCollage({ numbered: false })
    expect(off.numbered).toBeUndefined()
  })

  it("omits imageLabels when every label is empty/whitespace", async () => {
    const [, opts] = await runCollage({
      imageLabelBySource: { A: "   ", B: "" },
    })
    expect(opts.imageLabels).toBeUndefined()
  })

  it("passes badgePosition through only when it is a known corner (the route defaults to top-left)", async () => {
    const [, right] = await runCollage({ numbered: true, badgePosition: "top-right" })
    expect(right.badgePosition).toBe("top-right")
    const [, left] = await runCollage({ numbered: true, badgePosition: "top-left" })
    expect(left.badgePosition).toBe("top-left")
    const [, absent] = await runCollage({ numbered: true })
    expect(absent.badgePosition).toBeUndefined()
    const [, junk] = await runCollage({ numbered: true, badgePosition: "bottom-left" })
    expect(junk.badgePosition).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// video-overlay — the single-node run (spec §7 "Validator + engine parity"):
// the shared assembly, the shared validator's refusal in the user's words, and
// the extra fields the run writes on the node and its result.
// ---------------------------------------------------------------------------

describe("video-overlay", () => {
  const V = "http://vid.mp4"

  it("no base video → a toast, a reject, no API call", async () => {
    mockResolveNodeInputs.mockReturnValue({ overlayImageUrls: ["http://a.png"] })
    const promise = executeNode(makeNode("video-overlay", { layers: [] }), makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Video Overlay needs a base video")
    expect(mockToastError).toHaveBeenCalledWith('Node "video-overlay": no base video connected (video handle)')
    expect(mockPollJobWithNodeUpdate).not.toHaveBeenCalled()
    expect(mockVideoOverlayApi).not.toHaveBeenCalled()
  })

  it("end ≤ start → the validator's English in the reject, the user's words in the toast, no API call", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: V, overlayImageUrls: ["http://a.png", "http://b.png"] })
    const promise = executeNode(makeNode("video-overlay", { layers: [null, { start: 5, end: 4 }] }), makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Layer 2: end (4 s) must be after start (5 s)")
    // tx() in the UI language (English here): proccfg.videoOverlay.layerPrefix + err.end_before_start.
    expect(mockToastError).toHaveBeenCalledWith('Node "video-overlay": Layer 2: End must be after start')
    expect(mockPollJobWithNodeUpdate).not.toHaveBeenCalled()
    expect(mockVideoOverlayApi).not.toHaveBeenCalled()
  })

  it("a wired slot with no settings runs as DEFAULT_VIDEO_OVERLAY_LAYER; an empty unwired slot is dropped; every layer carries its slot", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: V, overlayImageUrls: ["http://a.png"] })
    mockVideoOverlayApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    const node = makeNode("video-overlay", { layers: [null, null, { imageUrl: "http://own.png", start: 1 }] })
    await executeNode(node, makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith("n1", expect.any(Function), "generatedVideoUrl", "Video Overlay", expect.anything(), expect.any(Function))
    await mockPollJobWithNodeUpdate.mock.calls[0][1]()
    expect(mockVideoOverlayApi).toHaveBeenCalledWith({
      videoUrl: V,
      layers: [
        { ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: "http://a.png", slot: 1 },
        { ...expandVideoOverlayLayer({ imageUrl: "http://own.png", start: 1 }), slot: 3 },
      ],
      userId: "u1",
      // The canvas key rides on the request: the worker echoes it into the
      // job's output_data, so a result that lands after a page reload
      // (restore / reconcile read the REST job) reads fresh too.
      resultCompositionKey: videoOverlayCompositionKey({ baseUrl: V, sources: videoOverlaySlotSources(node.data.layers, ["http://a.png"]), data: node.data }),
    })
  })

  it("a key past the route's bound is not sent (the run still starts; only a reload would read it old)", async () => {
    const long = `http://${"x".repeat(VIDEO_OVERLAY_MAX_COMPOSITION_KEY_LENGTH)}.png`
    mockResolveNodeInputs.mockReturnValue({ videoUrl: V, overlayImageUrls: [long] })
    mockVideoOverlayApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("video-overlay", { layers: [] }), makeCtx())
    await mockPollJobWithNodeUpdate.mock.calls[0][1]()
    expect(mockVideoOverlayApi.mock.calls[0][0]).not.toHaveProperty("resultCompositionKey")
  })

  it("a list row fanned into a layer handle never replaces the base video (the override is ignored; engine parity)", async () => {
    const wired = ["http://row-img.png"]
    mockResolveNodeInputs.mockReturnValue({ videoUrl: V, overlayImageUrls: wired })
    mockVideoOverlayApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    const node = makeNode("video-overlay", { layers: [] })
    await executeNode(node, makeCtx(), undefined, "http://row-img.png", 0)
    await mockPollJobWithNodeUpdate.mock.calls[0][1]()
    expect(mockVideoOverlayApi).toHaveBeenCalledWith(expect.objectContaining({ videoUrl: V }))
    expect(mockVideoOverlayApi.mock.calls[0][0].layers).toEqual([
      { ...DEFAULT_VIDEO_OVERLAY_LAYER, imageUrl: "http://row-img.png", slot: 1 },
    ])
    // The composition key is built from the real base too.
    const extra = mockPollJobWithNodeUpdate.mock.calls[0][5] as (od: Record<string, unknown>) => Record<string, unknown>
    expect(extra({}).resultCompositionKey).toBe(
      videoOverlayCompositionKey({ baseUrl: V, sources: videoOverlaySlotSources(node.data.layers, wired), data: node.data }),
    )
  })

  it("the extra-fields callback writes the warnings, the output size and length, and the composition key the node computes", async () => {
    const wired = ["http://a.png"]
    mockResolveNodeInputs.mockReturnValue({ videoUrl: V, overlayImageUrls: wired })
    mockVideoOverlayApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    const node = makeNode("video-overlay", { layers: [{ start: 2, preset: "card" }], outputAspect: "9:16" })
    await executeNode(node, makeCtx())
    const extra = mockPollJobWithNodeUpdate.mock.calls[0][5] as (od: Record<string, unknown>) => Record<string, unknown>
    const warnings = [{ layer: 0, slot: 1, code: "clipped", detail: "ends at 9 s, clipped to the video end (5.00 s)" }]
    expect(extra({ warnings, width: 1080, height: 1920, durationSec: 5 })).toEqual({
      warnings,
      width: 1080,
      height: 1920,
      durationSec: 5,
      resultCompositionKey: videoOverlayCompositionKey({ baseUrl: V, sources: videoOverlaySlotSources(node.data.layers, wired), data: node.data }),
    })
    // A run with no warnings still replaces the last run's line.
    expect(extra({})).toMatchObject({ warnings: [] })
  })
})
