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
  getJobStatus: vi.fn(),
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
  transcribeApi: vi.fn(),
  downloadYouTubeAudio: vi.fn(),
  lipSyncApi: vi.fn(),
  motionTransferApi: vi.fn(),
  videoUpscaleApi: vi.fn(),
  mergeVideoAudioApi: vi.fn(),
  extractAudioApi: vi.fn(),
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

vi.mock("@/lib/ai-writer-templates", () => ({
  getAIWriterTemplate: () => null,
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: () => "scene prompt",
}))

vi.mock("../node-input-resolver", () => ({
  resolveNodeInputs: (...args: unknown[]) => mockResolveNodeInputs(...args),
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: (...args: unknown[]) => mockExtractNodeOutput(...args),
  collectMediaAssets: (...args: unknown[]) => mockCollectMediaAssets(...args),
  buildAutoComposition: (...args: unknown[]) =>
    mockBuildAutoComposition(...args),
  collectAncestorRefs: (...args: unknown[]) =>
    mockCollectAncestorRefs(...args),
}))

vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: (...args: unknown[]) =>
    mockPollJobWithNodeUpdate(...args),
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

import {
  executeNode,
  resolveManualEdit,
  rejectManualEdit,
  rejectAllManualEdits,
} from "../execute-node"

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
// Manual edit bridge
// ---------------------------------------------------------------------------

describe("manual-edit bridge", () => {
  it("resolveManualEdit resolves a pending manual-edit promise", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    const promise = executeNode(makeNode("manual-edit", {}), makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "awaiting-user",
        inputVideoUrl: "http://vid.mp4",
      }),
    )
    resolveManualEdit("n1")
    await promise
  })

  it("rejectManualEdit rejects a pending manual-edit promise", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    const promise = executeNode(makeNode("manual-edit", {}), makeCtx())
    promise.catch(() => {})
    rejectManualEdit("n1", new Error("cancelled"))
    await expect(promise).rejects.toThrow("cancelled")
  })

  it("rejectAllManualEdits rejects all pending manual edits", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    const p1 = executeNode(
      { ...makeNode("manual-edit", {}), id: "a1" },
      makeCtx(),
    )
    const p2 = executeNode(
      { ...makeNode("manual-edit", {}), id: "a2" },
      makeCtx(),
    )
    p1.catch(() => {})
    p2.catch(() => {})
    rejectAllManualEdits()
    await expect(p1).rejects.toThrow("Workflow restarted")
    await expect(p2).rejects.toThrow("Workflow restarted")
  })

  it("resolveManualEdit is a no-op for unknown nodeId", () => {
    resolveManualEdit("unknown-node")
    // should not throw
  })
})

// ---------------------------------------------------------------------------
// generate-script
// ---------------------------------------------------------------------------

describe("generate-script", () => {
  it("rejects with 'No prompt' when prompt is empty", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("generate-script", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runScriptGeneration with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "test prompt" })
    mockRunScriptGeneration.mockResolvedValue(undefined)
    await executeNode(
      makeNode("generate-script", { sceneCount: 5 }),
      makeCtx(),
    )
    expect(mockRunScriptGeneration).toHaveBeenCalledWith(
      "n1",
      "test prompt",
      expect.anything(),
      5,
      undefined,
      undefined,
      undefined,
    )
  })

  it("passes sceneCount, tone, targetLength, provider from data", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "p" })
    mockRunScriptGeneration.mockResolvedValue(undefined)
    await executeNode(
      makeNode("generate-script", {
        sceneCount: 3,
        tone: "dramatic",
        targetLength: "short",
        provider: "claude",
      }),
      makeCtx(),
    )
    expect(mockRunScriptGeneration).toHaveBeenCalledWith(
      "n1",
      "p",
      expect.anything(),
      3,
      "dramatic",
      "short",
      "claude",
    )
  })
})

// ---------------------------------------------------------------------------
// generate-image
// ---------------------------------------------------------------------------

describe("generate-image", () => {
  it("rejects with 'No prompt' when no prompt available", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("generate-image", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runImageGeneration with prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "a cat" })
    mockRunImageGeneration.mockResolvedValue(undefined)
    mockCollectAncestorRefs.mockReturnValue([])
    await executeNode(makeNode("generate-image", {}), makeCtx())
    expect(mockRunImageGeneration).toHaveBeenCalledWith(
      "n1",
      "a cat",
      expect.anything(),
      undefined,
      undefined,
      undefined,
    )
  })

  it("uses overridePrompt when provided", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "original" })
    mockRunImageGeneration.mockResolvedValue(undefined)
    mockCollectAncestorRefs.mockReturnValue([])
    await executeNode(
      makeNode("generate-image", {}),
      makeCtx(),
      "override prompt",
    )
    expect(mockRunImageGeneration).toHaveBeenCalledWith(
      "n1",
      "override prompt",
      expect.anything(),
      undefined,
      undefined,
      undefined,
    )
  })

  it("truncates prompt longer than 2000 chars", async () => {
    const longPrompt = "x".repeat(2500)
    mockResolveNodeInputs.mockReturnValue({ prompt: longPrompt })
    mockRunImageGeneration.mockResolvedValue(undefined)
    mockCollectAncestorRefs.mockReturnValue([])
    await executeNode(makeNode("generate-image", {}), makeCtx())
    const calledPrompt = mockRunImageGeneration.mock.calls[0][1] as string
    expect(calledPrompt.length).toBe(2000)
    expect(calledPrompt.endsWith("...")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// edit-image
// ---------------------------------------------------------------------------

describe("edit-image", () => {
  it("rejects when no input image", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(makeNode("edit-image", {}), makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No input image")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runEditImage with imageUrl and provider", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://img.png",
    })
    mockRunEditImage.mockResolvedValue(undefined)
    await executeNode(
      makeNode("edit-image", { provider: "recraft-upscale" }),
      makeCtx(),
    )
    expect(mockRunEditImage).toHaveBeenCalledWith(
      "n1",
      "http://img.png",
      expect.anything(),
      undefined,
      "recraft-upscale",
    )
  })
})

// ---------------------------------------------------------------------------
// image-to-image
// ---------------------------------------------------------------------------

describe("image-to-image", () => {
  it("rejects when no input image", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("image-to-image", { prompt: "transform" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No input image")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no transformation prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://img.png",
    })
    const promise = executeNode(
      makeNode("image-to-image", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow(
      "Transformation prompt is required",
    )
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runImageToImage with correct args", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://img.png",
    })
    mockRunImageToImage.mockResolvedValue(undefined)
    await executeNode(
      makeNode("image-to-image", {
        prompt: "make it blue",
        provider: "nano-banana",
      }),
      makeCtx(),
    )
    expect(mockRunImageToImage).toHaveBeenCalledWith(
      "n1",
      "http://img.png",
      "make it blue",
      expect.anything(),
      "nano-banana",
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// image-to-video
// ---------------------------------------------------------------------------

describe("image-to-video", () => {
  it("rejects when no start frame", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("image-to-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No start frame image")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runVideoGeneration with startFrameUrl", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://frame.png",
    })
    mockRunVideoGeneration.mockResolvedValue(undefined)
    await executeNode(makeNode("image-to-video", {}), makeCtx())
    expect(mockRunVideoGeneration).toHaveBeenCalledWith(
      "n1",
      "http://frame.png",
      expect.anything(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// video-to-video
// ---------------------------------------------------------------------------

describe("video-to-video", () => {
  it("rejects when no source video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("video-to-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No source video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runVideoToVideoGeneration with videoUrl", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockRunVideoToVideoGeneration.mockResolvedValue(undefined)
    await executeNode(makeNode("video-to-video", {}), makeCtx())
    expect(mockRunVideoToVideoGeneration).toHaveBeenCalledWith(
      "n1",
      "http://vid.mp4",
      expect.anything(),
      undefined,
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// text-to-video
// ---------------------------------------------------------------------------

describe("text-to-video", () => {
  it("rejects when no prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("text-to-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runTextToVideoGeneration with prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "a sunset" })
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)
    await executeNode(makeNode("text-to-video", {}), makeCtx())
    expect(mockRunTextToVideoGeneration).toHaveBeenCalledWith(
      "n1",
      "a sunset",
      expect.anything(),
      undefined,
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// text-to-speech
// ---------------------------------------------------------------------------

describe("text-to-speech", () => {
  it("rejects when no text", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("text-to-speech", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No text")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runTextToSpeechGeneration with text", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToSpeechGeneration.mockResolvedValue(undefined)
    await executeNode(
      makeNode("text-to-speech", {
        textSource: "direct",
        directText: "hello world",
      }),
      makeCtx(),
    )
    expect(mockRunTextToSpeechGeneration).toHaveBeenCalledWith(
      "n1",
      "hello world",
      expect.anything(),
      undefined,
      undefined,
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// generate-music
// ---------------------------------------------------------------------------

describe("generate-music", () => {
  it("rejects when no prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("generate-music", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate via runProcessingNode", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "jazz" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("generate-music", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Generate Music",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// audio-isolation
// ---------------------------------------------------------------------------

describe("audio-isolation", () => {
  it("rejects when no audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("audio-isolation", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate with audioUrl", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrl: "http://audio.mp3",
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("audio-isolation", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Voice Extractor",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// character
// ---------------------------------------------------------------------------

describe("character", () => {
  it("rejects when no characterName", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(makeNode("character", {}), makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No character name")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runCharacterGeneration with data", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockRunCharacterGeneration.mockResolvedValue(undefined)
    await executeNode(
      makeNode("character", { characterName: "Hero" }),
      makeCtx(),
    )
    expect(mockRunCharacterGeneration).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ characterName: "Hero" }),
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// face
// ---------------------------------------------------------------------------

describe("face", () => {
  it("rejects when no faceName", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(makeNode("face", {}), makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No face name")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no sourceImageUrl", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("face", { faceName: "Alice" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No reference photo")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runFaceGeneration with merged data", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockRunFaceGeneration.mockResolvedValue(undefined)
    await executeNode(
      makeNode("face", {
        faceName: "Alice",
        sourceImageUrl: "http://face.png",
      }),
      makeCtx(),
    )
    expect(mockRunFaceGeneration).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        faceName: "Alice",
        sourceImageUrl: "http://face.png",
      }),
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// object
// ---------------------------------------------------------------------------

describe("object", () => {
  it("rejects when no objectName", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(makeNode("object", {}), makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No object name")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runObjectGeneration with data", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockRunObjectGeneration.mockResolvedValue(undefined)
    await executeNode(
      makeNode("object", { objectName: "Sword" }),
      makeCtx(),
    )
    expect(mockRunObjectGeneration).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ objectName: "Sword" }),
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// location
// ---------------------------------------------------------------------------

describe("location", () => {
  it("rejects when no locationName", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(makeNode("location", {}), makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No location name")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runLocationGeneration with data", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockRunLocationGeneration.mockResolvedValue(undefined)
    await executeNode(
      makeNode("location", { locationName: "Castle" }),
      makeCtx(),
    )
    expect(mockRunLocationGeneration).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ locationName: "Castle" }),
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// combine-text
// ---------------------------------------------------------------------------

describe("combine-text", () => {
  it("sets combinedText and completed status", async () => {
    const sourceNode = {
      id: "src1",
      type: "text-prompt",
      data: { text: "hello", label: "T" },
    }
    mockNodes = [makeNode("combine-text", { separator: "newline" }), sourceNode]
    mockEdges = [{ id: "e1", source: "src1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue("hello")
    await executeNode(
      makeNode("combine-text", { separator: "newline" }),
      makeCtx(),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        combinedText: "hello",
        executionStatus: "completed",
      }),
    )
  })

  it("joins texts with comma separator", async () => {
    const src1 = {
      id: "src1",
      type: "text-prompt",
      data: { text: "hello", label: "T1" },
    }
    const src2 = {
      id: "src2",
      type: "text-prompt",
      data: { text: "world", label: "T2" },
    }
    mockNodes = [
      makeNode("combine-text", { separator: "comma" }),
      src1,
      src2,
    ]
    mockEdges = [
      { id: "e1", source: "src1", target: "n1" },
      { id: "e2", source: "src2", target: "n1" },
    ]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.id === "src1") return "hello"
      if (node.id === "src2") return "world"
      return undefined
    })
    await executeNode(
      makeNode("combine-text", { separator: "comma" }),
      makeCtx(),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        combinedText: "hello, world",
        executionStatus: "completed",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// split-text
// ---------------------------------------------------------------------------

describe("split-text", () => {
  it("sets splitResults and __listResults", async () => {
    const sourceNode = {
      id: "src1",
      type: "ai-writer",
      data: { label: "W" },
    }
    mockNodes = [makeNode("split-text", {}), sourceNode]
    mockEdges = [{ id: "e1", source: "src1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue(
      "part one===NEXT===part two===NEXT===part three",
    )
    await executeNode(makeNode("split-text", {}), makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        splitResults: ["part one", "part two", "part three"],
        __listResults: ["part one", "part two", "part three"],
        __listTotal: 3,
        executionStatus: "completed",
      }),
    )
  })

  it("sets failed when no input text", async () => {
    mockNodes = [makeNode("split-text", {})]
    mockEdges = []
    mockResolveNodeInputs.mockReturnValue({})
    await executeNode(makeNode("split-text", {}), makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "failed",
        errorMessage: "No input text received",
      }),
    )
  })

  it("trims whitespace and removes empty parts by default", async () => {
    const sourceNode = {
      id: "src1",
      type: "ai-writer",
      data: { label: "W" },
    }
    mockNodes = [makeNode("split-text", {}), sourceNode]
    mockEdges = [{ id: "e1", source: "src1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue(
      "  part one  ===NEXT===   ===NEXT===  part two  ",
    )
    await executeNode(makeNode("split-text", {}), makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        splitResults: ["part one", "part two"],
        executionStatus: "completed",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// video-composer
// ---------------------------------------------------------------------------

describe("video-composer", () => {
  it("rejects when no composition prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("video-composer", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No composition prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("rejects when no media assets", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockCollectMediaAssets.mockReturnValue([])
    const promise = executeNode(
      makeNode("video-composer", {
        compositionPrompt: "compose this",
      }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No media assets")
    expect(mockToastError).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// combine-videos
// ---------------------------------------------------------------------------

describe("combine-videos", () => {
  it("rejects when fewer than 2 videos", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrls: ["http://a.mp4"] })
    const promise = executeNode(
      makeNode("combine-videos", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Need at least 2 videos")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls runCombineVideos with urls and options", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrls: ["http://a.mp4", "http://b.mp4"],
    })
    mockRunCombineVideos.mockResolvedValue(undefined)
    await executeNode(
      makeNode("combine-videos", {
        transition: "dissolve",
        transitionDuration: 1.0,
        audioMode: "crossfade",
      }),
      makeCtx(),
    )
    expect(mockRunCombineVideos).toHaveBeenCalledWith(
      "n1",
      ["http://a.mp4", "http://b.mp4"],
      "dissolve",
      1.0,
      "crossfade",
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// render-video
// ---------------------------------------------------------------------------

describe("render-video", () => {
  it("uses upstream plan when connected to composer", async () => {
    const composerNode = {
      id: "vc1",
      type: "video-composer",
      data: {
        label: "VC",
        sceneGraph: { tracks: [] },
      },
    }
    mockNodes = [
      makeNode("render-video", {}),
      composerNode,
    ]
    mockEdges = [{ id: "e1", source: "vc1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    mockRenderVideoWithSceneGraph.mockResolvedValue({ jobId: "j1" })
    await executeNode(makeNode("render-video", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Render Video",
      expect.anything(),
      undefined,
    )
  })

  it("auto-composes when no upstream plan", async () => {
    mockNodes = [makeNode("render-video", {})]
    mockEdges = []
    mockResolveNodeInputs.mockReturnValue({})
    mockCollectMediaAssets.mockReturnValue([
      { type: "image", url: "http://img.png" },
    ])
    mockBuildAutoComposition.mockReturnValue({ tracks: [] })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    mockRenderVideoWithSceneGraph.mockResolvedValue({ jobId: "j1" })
    await executeNode(
      makeNode("render-video", {
        fps: 30,
        durationSeconds: 10,
        aspectRatio: "16:9",
      }),
      makeCtx(),
    )
    expect(mockBuildAutoComposition).toHaveBeenCalled()
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Unknown node type
// ---------------------------------------------------------------------------

describe("unknown node type", () => {
  it("returns resolved promise for unknown type", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    await executeNode(makeNode("totally-made-up-node", {}), makeCtx())
    // should resolve without error
  })
})
