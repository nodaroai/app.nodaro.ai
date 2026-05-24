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
const mockSunoGenerateApi = vi.fn()
const mockSunoCoverApi = vi.fn()
const mockSunoExtendApi = vi.fn()
const mockTextToAudioApi = vi.fn()
const mockTranscribeApi = vi.fn()
const mockGetJobStatus = vi.fn()
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
  getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
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
  textToAudioApi: (...args: unknown[]) => mockTextToAudioApi(...args),
  audioIsolationApi: vi.fn(),
  sunoGenerateApi: (...args: unknown[]) => mockSunoGenerateApi(...args),
  sunoCoverApi: (...args: unknown[]) => mockSunoCoverApi(...args),
  sunoExtendApi: (...args: unknown[]) => mockSunoExtendApi(...args),
  sunoLyricsApi: vi.fn(),
  sunoSeparateApi: vi.fn(),
  sunoMusicVideoApi: vi.fn(),
  transcribeApi: (...args: unknown[]) => mockTranscribeApi(...args),
  downloadYouTubeAudio: vi.fn(),
  lipSyncApi: vi.fn(),
  motionTransferApi: vi.fn(),
  videoUpscaleApi: vi.fn(),
  mergeVideoAudioApi: vi.fn(),
  trimAudioApi: vi.fn(),
  trimVideoApi: vi.fn(),
  transcodeVideoApi: vi.fn(),
  speedRampApi: vi.fn(),
  loopVideoApi: vi.fn(),
  fadeVideoApi: vi.fn(),
  resizeVideoApi: vi.fn(),
  adjustVolumeApi: vi.fn(),
  addCaptionsApi: vi.fn(),
  mixAudioApi: vi.fn(),
  combineVideos: vi.fn(),
  editImage: vi.fn(),
  imageToImage: vi.fn(),
  generateVideo: vi.fn(),
  videoToVideo: vi.fn(),
  textToVideo: vi.fn(),
  textToSpeech: vi.fn(),
  generateScriptApi: vi.fn(),
  setForcePrivate: vi.fn(),
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
// after-effects
// ---------------------------------------------------------------------------

describe("after-effects", () => {
  it("rejects when no effect prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("after-effects", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No effect prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no video input connected", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockNodes = [makeNode("after-effects", { effectPrompt: "add grain" })]
    mockEdges = []
    const promise = executeNode(
      makeNode("after-effects", { effectPrompt: "add grain" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls generateAfterEffects then updates node data on success", async () => {
    const sourceNode = {
      id: "vid1",
      type: "image-to-video",
      data: { label: "Video" },
    }
    mockNodes = [
      makeNode("after-effects", {
        effectPrompt: "add film grain",
        fps: 30,
        width: 1920,
        height: 1080,
        durationSeconds: 10,
      }),
      sourceNode,
    ]
    mockEdges = [{ id: "e1", source: "vid1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://video.mp4" })
    mockExtractNodeOutput.mockReturnValue("http://video.mp4")
    mockGenerateAfterEffects.mockResolvedValue({
      jobId: "j1",
      effectPlan: { effects: ["grain"] },
    })

    await executeNode(
      makeNode("after-effects", {
        effectPrompt: "add film grain",
        fps: 30,
        width: 1920,
        height: 1080,
        durationSeconds: 10,
      }),
      makeCtx(),
    )

    expect(mockGenerateAfterEffects).toHaveBeenCalledWith({
      prompt: "add film grain",
      inputVideoUrl: "http://video.mp4",
      fps: 30,
      width: 1920,
      height: 1080,
      durationSeconds: 10,
      userId: "u1",
    })
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        effectPlan: { effects: ["grain"] },
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "After effects plan generated",
    )
  })
})

// ---------------------------------------------------------------------------
// lottie-overlay
// ---------------------------------------------------------------------------

describe("lottie-overlay", () => {
  it("rejects when no overlay prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("lottie-overlay", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No overlay prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no video input connected", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockNodes = [
      makeNode("lottie-overlay", { overlayPrompt: "add sparkles" }),
    ]
    mockEdges = []
    const promise = executeNode(
      makeNode("lottie-overlay", { overlayPrompt: "add sparkles" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls generateLottieOverlay and updates node on success", async () => {
    const sourceNode = {
      id: "vid1",
      type: "image-to-video",
      data: { label: "Video" },
    }
    mockNodes = [
      makeNode("lottie-overlay", {
        overlayPrompt: "add sparkles",
        fps: 30,
        width: 1920,
        height: 1080,
        durationSeconds: 5,
      }),
      sourceNode,
    ]
    mockEdges = [
      { id: "e1", source: "vid1", target: "n1", targetHandle: "in" },
    ]
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://video.mp4" })
    mockExtractNodeOutput.mockReturnValue("http://video.mp4")
    mockGenerateLottieOverlay.mockResolvedValue({
      jobId: "j2",
      overlayPlan: { overlays: [] },
    })

    await executeNode(
      makeNode("lottie-overlay", {
        overlayPrompt: "add sparkles",
        fps: 30,
        width: 1920,
        height: 1080,
        durationSeconds: 5,
      }),
      makeCtx(),
    )

    expect(mockGenerateLottieOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "add sparkles",
        inputVideoUrl: "http://video.mp4",
        fps: 30,
        width: 1920,
        height: 1080,
        durationSeconds: 5,
        userId: "u1",
      }),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        overlayPlan: { overlays: [] },
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// 3d-title
// ---------------------------------------------------------------------------

describe("3d-title", () => {
  it("rejects when no title prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("3d-title", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No title prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls generate3DTitle with correct dimensions for 16:9", async () => {
    mockNodes = [makeNode("3d-title", { titlePrompt: "Epic Title" })]
    mockEdges = []
    mockResolveNodeInputs.mockReturnValue({})
    mockGenerate3DTitle.mockResolvedValue({
      jobId: "j3",
      titlePlan: { texts: ["Epic Title"] },
    })

    await executeNode(
      makeNode("3d-title", {
        titlePrompt: "Epic Title",
        fps: 30,
        aspectRatio: "16:9",
        durationSeconds: 5,
        backgroundColor: "#000000",
      }),
      makeCtx(),
    )

    expect(mockGenerate3DTitle).toHaveBeenCalledWith({
      prompt: "Epic Title",
      fps: 30,
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      durationSeconds: 5,
      backgroundColor: "#000000",
      backgroundMediaUrl: undefined,
      userId: "u1",
    })
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        titlePlan: { texts: ["Epic Title"] },
      }),
    )
  })

  it("resolves background media from connected node", async () => {
    const bgNode = {
      id: "bg1",
      type: "generate-image",
      data: { label: "BG" },
    }
    mockNodes = [
      makeNode("3d-title", {
        titlePrompt: "Title",
        fps: 30,
        aspectRatio: "9:16",
        durationSeconds: 3,
      }),
      bgNode,
    ]
    mockEdges = [
      { id: "e1", source: "bg1", target: "n1", targetHandle: "background" },
    ]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue("http://bg.png")
    mockGenerate3DTitle.mockResolvedValue({
      jobId: "j4",
      titlePlan: { texts: ["Title"] },
    })

    await executeNode(
      makeNode("3d-title", {
        titlePrompt: "Title",
        fps: 30,
        aspectRatio: "9:16",
        durationSeconds: 3,
      }),
      makeCtx(),
    )

    expect(mockGenerate3DTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1080,
        height: 1920,
        backgroundMediaUrl: "http://bg.png",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// motion-graphics
// ---------------------------------------------------------------------------

describe("motion-graphics", () => {
  it("calls generateMotionGraphics with prompt and dimensions", async () => {
    mockNodes = [
      makeNode("motion-graphics", {
        motionPrompt: "animated lower third",
        fps: 24,
        aspectRatio: "1:1",
        durationSeconds: 4,
        backgroundColor: "#ffffff",
      }),
    ]
    mockEdges = []
    mockResolveNodeInputs.mockReturnValue({})
    mockGenerateMotionGraphics.mockResolvedValue({
      jobId: "j5",
      motionPlan: { elements: [] },
    })

    await executeNode(
      makeNode("motion-graphics", {
        motionPrompt: "animated lower third",
        fps: 24,
        aspectRatio: "1:1",
        durationSeconds: 4,
        backgroundColor: "#ffffff",
      }),
      makeCtx(),
    )

    expect(mockGenerateMotionGraphics).toHaveBeenCalledWith({
      prompt: "animated lower third",
      fps: 24,
      aspectRatio: "1:1",
      width: 1080,
      height: 1080,
      durationSeconds: 4,
      backgroundColor: "#ffffff",
      userId: "u1",
    })
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        motionPlan: { elements: [] },
      }),
    )
  })

  it("defaults to 16:9 dimensions for unknown aspect ratio", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockGenerateMotionGraphics.mockResolvedValue({
      jobId: "j6",
      motionPlan: {},
    })

    await executeNode(
      makeNode("motion-graphics", {
        motionPrompt: "text animation",
        fps: 30,
        aspectRatio: "custom",
        durationSeconds: 5,
      }),
      makeCtx(),
    )

    expect(mockGenerateMotionGraphics).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1920,
        height: 1080,
      }),
    )
  })

  it("sets failed status on error", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockGenerateMotionGraphics.mockRejectedValue(new Error("AI failure"))

    const promise = executeNode(
      makeNode("motion-graphics", {
        motionPrompt: "kinetic typography",
        fps: 30,
        aspectRatio: "16:9",
        durationSeconds: 5,
      }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("AI failure")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "failed",
        errorMessage: "AI failure",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// suno-generate
// ---------------------------------------------------------------------------

describe("suno-generate", () => {
  it("rejects when no prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-generate", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls sunoGenerateApi via pollJobWithNodeUpdate", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "upbeat jazz" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(
      makeNode("suno-generate", {
        model: "v4",
        style: "jazz",
        title: "My Song",
        lyrics: "la la la",
      }),
      makeCtx(),
    )

    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Generate",
      expect.anything(),
      expect.any(Function),
    )

    // Invoke the API call function to verify it calls sunoGenerateApi
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    mockSunoGenerateApi.mockResolvedValue({ jobId: "suno-j1" })
    await apiCallFn()

    expect(mockSunoGenerateApi).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "upbeat jazz",
        model: "v4",
        style: "jazz",
        title: "My Song",
        lyrics: "la la la",
        userId: "u1",
      }),
    )
  })

  it("passes extra output fields extractor for sunoTrackId", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "pop song" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(
      makeNode("suno-generate", {}),
      makeCtx(),
    )

    // The extraOutputFields function is the 6th argument
    const extraOutputFn = mockPollJobWithNodeUpdate.mock.calls[0][5]
    const result = extraOutputFn({
      sunoTrackId: "track-123",
      sunoTaskId: "task-456",
    })
    expect(result).toEqual({
      sunoTrackId: "track-123",
      sunoTaskId: "task-456",
    })
  })
})

// ---------------------------------------------------------------------------
// suno-cover
// ---------------------------------------------------------------------------

describe("suno-cover", () => {
  it("rejects when no prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({ uploadUrl: "http://audio.mp3" })
    const promise = executeNode(
      makeNode("suno-cover", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no upload URL", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "rock cover" })
    const promise = executeNode(
      makeNode("suno-cover", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No upload URL")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls sunoCoverApi via pollJobWithNodeUpdate with correct params", async () => {
    mockResolveNodeInputs.mockReturnValue({
      prompt: "rock cover",
      uploadUrl: "http://audio.mp3",
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(
      makeNode("suno-cover", {
        model: "v4",
        style: "rock",
      }),
      makeCtx(),
    )

    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Cover",
      expect.anything(),
      expect.any(Function),
    )

    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    mockSunoCoverApi.mockResolvedValue({ jobId: "cover-j1" })
    await apiCallFn()

    expect(mockSunoCoverApi).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "rock cover",
        uploadUrl: "http://audio.mp3",
        model: "v4",
        style: "rock",
        userId: "u1",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// suno-extend
// ---------------------------------------------------------------------------

describe("suno-extend", () => {
  it("rejects when no audio ID", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-extend", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio ID")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls sunoExtendApi via pollJobWithNodeUpdate", async () => {
    mockResolveNodeInputs.mockReturnValue({ sunoTrackId: "track-abc" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(
      makeNode("suno-extend", {
        model: "v4",
        prompt: "extend with chorus",
      }),
      makeCtx(),
    )

    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Extend",
      expect.anything(),
      expect.any(Function),
    )

    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    mockSunoExtendApi.mockResolvedValue({ jobId: "extend-j1" })
    await apiCallFn()

    expect(mockSunoExtendApi).toHaveBeenCalledWith(
      expect.objectContaining({
        audioId: "track-abc",
        prompt: "extend with chorus",
        model: "v4",
        userId: "u1",
      }),
    )
  })

  it("uses audioId from node data when no upstream sunoTrackId", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(
      makeNode("suno-extend", { audioId: "manual-id-123" }),
      makeCtx(),
    )

    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    mockSunoExtendApi.mockResolvedValue({ jobId: "extend-j2" })
    await apiCallFn()

    expect(mockSunoExtendApi).toHaveBeenCalledWith(
      expect.objectContaining({
        audioId: "manual-id-123",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// text-to-audio
// ---------------------------------------------------------------------------

describe("text-to-audio", () => {
  it("rejects when no prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("text-to-audio", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls textToAudioApi via pollJobWithNodeUpdate", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "thunder sounds" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(
      makeNode("text-to-audio", {
        provider: "elevenlabs-sfx",
        duration: 5,
        loop: true,
        promptInfluence: 0.5,
      }),
      makeCtx(),
    )

    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Text to Audio",
      expect.anything(),
      undefined,
    )

    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    mockTextToAudioApi.mockResolvedValue({ jobId: "ta-j1" })
    await apiCallFn()

    expect(mockTextToAudioApi).toHaveBeenCalledWith(
      "thunder sounds",
      "elevenlabs-sfx",
      5,
      "u1",
      { loop: true, promptInfluence: 0.5 },
    )
  })

  it("passes undefined sfxOptions when provider is not elevenlabs-sfx", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "rain" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(
      makeNode("text-to-audio", {
        provider: "other-provider",
        duration: 10,
      }),
      makeCtx(),
    )

    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    mockTextToAudioApi.mockResolvedValue({ jobId: "ta-j2" })
    await apiCallFn()

    expect(mockTextToAudioApi).toHaveBeenCalledWith(
      "rain",
      "other-provider",
      10,
      "u1",
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// image-to-text
// ---------------------------------------------------------------------------

describe("image-to-text", () => {
  it("rejects when no image input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("image-to-text", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No image input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls imageToTextApi and updates node with generatedText", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://photo.jpg",
    })
    mockImageToTextApi.mockResolvedValue({
      jobId: "it-j1",
      generatedText: "A beautiful sunset over the ocean",
    })

    await executeNode(
      makeNode("image-to-text", {
        detailLevel: "detailed",
        customPrompt: "Describe this image",
      }),
      makeCtx(),
    )

    expect(mockImageToTextApi).toHaveBeenCalledWith(
      "http://photo.jpg",
      "detailed",
      "Describe this image",
      "u1",
      undefined,
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedText: "A beautiful sunset over the ocean",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Image described successfully",
    )
  })

  it("sets failed status when imageToTextApi throws", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://photo.jpg",
    })
    mockImageToTextApi.mockRejectedValue(new Error("Vision API error"))

    const promise = executeNode(
      makeNode("image-to-text", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Vision API error")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "failed",
        errorMessage: "Vision API error",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// transcribe
// ---------------------------------------------------------------------------

describe("transcribe", () => {
  it("rejects when no audio/video input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("transcribe", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls transcribeApi with correct params and sets running status", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrl: "http://speech.mp3",
    })

    // Make transcribeApi return a promise that won't resolve (simulating the poll loop)
    mockTranscribeApi.mockResolvedValue({ jobId: "tr-j1" })

    // The transcribe node uses a custom poll loop with setInterval.
    // We need to make getJobStatus resolve with completed to end the poll.
    mockGetJobStatus.mockResolvedValue({
      status: "completed",
      output_data: {
        text: "Hello world",
        language: "en",
      },
    })

    // Use fake timers to control the setInterval
    vi.useFakeTimers()

    const promise = executeNode(
      makeNode("transcribe", {
        provider: "deepgram",
        language: "en",
      }),
      makeCtx(),
    )

    // Allow the transcribeApi promise to resolve
    await vi.advanceTimersByTimeAsync(0)

    expect(mockTranscribeApi).toHaveBeenCalledWith(
      "http://speech.mp3",
      "deepgram",
      "en",
      "u1",
      undefined,
      undefined,
    )

    // Advance timer to trigger the poll interval
    await vi.advanceTimersByTimeAsync(2000)

    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedText: "Hello world",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Transcription complete")

    vi.useRealTimers()
  })

  it("sets failed status when transcribeApi throws", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrl: "http://speech.mp3",
    })
    mockTranscribeApi.mockRejectedValue(new Error("Service unavailable"))

    const promise = executeNode(
      makeNode("transcribe", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Service unavailable")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "failed",
        errorMessage: "Service unavailable",
      }),
    )
  })
})
