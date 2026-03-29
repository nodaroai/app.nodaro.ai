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
const mockTextToDialogueApi = vi.fn()
const mockVoiceChangerApi = vi.fn()
const mockDubbingApi = vi.fn()
const mockVoiceRemixApi = vi.fn()
const mockVoiceDesignApi = vi.fn()
const mockForcedAlignmentApi = vi.fn()
const mockSunoMashupApi = vi.fn()
const mockSunoReplaceSectionApi = vi.fn()
const mockSunoStyleBoostApi = vi.fn()
const mockSunoAddInstrumentalApi = vi.fn()
const mockSunoAddVocalsApi = vi.fn()
const mockSunoConvertWavApi = vi.fn()
const mockSunoUploadExtendApi = vi.fn()
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
  sunoMashupApi: (...args: unknown[]) => mockSunoMashupApi(...args),
  sunoReplaceSectionApi: (...args: unknown[]) => mockSunoReplaceSectionApi(...args),
  sunoStyleBoostApi: (...args: unknown[]) => mockSunoStyleBoostApi(...args),
  sunoAddInstrumentalApi: (...args: unknown[]) => mockSunoAddInstrumentalApi(...args),
  sunoAddVocalsApi: (...args: unknown[]) => mockSunoAddVocalsApi(...args),
  sunoConvertWavApi: (...args: unknown[]) => mockSunoConvertWavApi(...args),
  sunoUploadExtendApi: (...args: unknown[]) => mockSunoUploadExtendApi(...args),
  textToDialogueApi: (...args: unknown[]) => mockTextToDialogueApi(...args),
  voiceChangerApi: (...args: unknown[]) => mockVoiceChangerApi(...args),
  dubbingApi: (...args: unknown[]) => mockDubbingApi(...args),
  voiceRemixApi: (...args: unknown[]) => mockVoiceRemixApi(...args),
  voiceDesignApi: (...args: unknown[]) => mockVoiceDesignApi(...args),
  forcedAlignmentApi: (...args: unknown[]) => mockForcedAlignmentApi(...args),
  transcribeApi: vi.fn(),
  downloadYouTubeAudio: vi.fn(),
  lipSyncApi: vi.fn(),
  speechToVideoApi: vi.fn(),
  soraStoryboardApi: vi.fn(),
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
      undefined,
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
      undefined,
      undefined,
      undefined,
      undefined,
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
      undefined,
      undefined,
      undefined,
      undefined,
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
      expect.anything(),
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
      expect.anything(),
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
      expect.objectContaining({
        aspectRatio: undefined,
        audio: undefined,
        duration: undefined,
        multiShots: undefined,
        referenceImageUrl: undefined,
        resolution: undefined,
        seed: undefined,
      }),
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
      expect.objectContaining({ duration: undefined, aspectRatio: undefined }),
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
      { voiceType: "premade" },
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
      undefined,
      undefined,
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

// ---------------------------------------------------------------------------
// text-to-dialogue
// ---------------------------------------------------------------------------

describe("text-to-dialogue", () => {
  it("rejects when no dialogue lines", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("text-to-dialogue", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No dialogue lines")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("text-to-dialogue", {
        dialogue: [{ voice: "Rachel", text: "Hello" }],
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Text to Dialogue",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// voice-changer
// ---------------------------------------------------------------------------

describe("voice-changer", () => {
  it("rejects when no audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("voice-changer", { voiceId: "abc" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("voice-changer", { voiceId: "abc" }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Voice Changer",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// dubbing
// ---------------------------------------------------------------------------

describe("dubbing", () => {
  it("rejects when no audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("dubbing", { targetLanguage: "es" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("dubbing", { targetLanguage: "es" }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Dubbing",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// voice-remix
// ---------------------------------------------------------------------------

describe("voice-remix", () => {
  it("rejects when no text", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("voice-remix", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No text")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("voice-remix", {
        text: "Hello world",
        voiceDescription: "deep male voice",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Voice Remix",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// voice-design
// ---------------------------------------------------------------------------

describe("voice-design", () => {
  it("rejects when no text", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("voice-design", { voiceDescription: "warm female" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow()
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("voice-design", {
        text: "Hello world",
        voiceDescription: "warm female",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Voice Design",
      expect.anything(),
      expect.any(Function),
    )
  })
})

// ---------------------------------------------------------------------------
// forced-alignment
// ---------------------------------------------------------------------------

describe("forced-alignment", () => {
  it("rejects when no audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("forced-alignment", { transcript: "Hello" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls forcedAlignmentApi on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    mockForcedAlignmentApi.mockRejectedValue(new Error("test"))
    const promise = executeNode(
      makeNode("forced-alignment", { transcript: "Hello world" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await new Promise((r) => setTimeout(r, 10))
    expect(mockForcedAlignmentApi).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// lip-sync
// ---------------------------------------------------------------------------

describe("lip-sync", () => {
  it("rejects when no portrait image", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://speech.mp3" })
    const promise = executeNode(
      makeNode("lip-sync", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No portrait image")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://face.png",
      audioUrl: "http://speech.mp3",
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("lip-sync", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Lip Sync",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// motion-transfer
// ---------------------------------------------------------------------------

describe("motion-transfer", () => {
  it("rejects when no character image", async () => {
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

  it("calls pollJobWithNodeUpdate when edges provide inputs", async () => {
    const imgNode = {
      id: "img1",
      type: "generate-image",
      data: { label: "Img" },
    }
    const vidNode = {
      id: "vid1",
      type: "image-to-video",
      data: { label: "Vid" },
    }
    mockNodes = [makeNode("motion-transfer", {}), imgNode, vidNode]
    mockEdges = [
      { id: "e1", source: "img1", target: "n1" },
      { id: "e2", source: "vid1", target: "n1" },
    ]
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://face.png", videoUrl: "http://motion.mp4" })
    mockExtractNodeOutput.mockImplementation((node: any) => {
      if (node.id === "img1") return "http://face.png"
      if (node.id === "vid1") return "http://motion.mp4"
      return undefined
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("motion-transfer", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Motion Transfer",
      expect.anything(),
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

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("video-upscale", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Upscale Video",
      expect.anything(),
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

  it("calls imageToTextApi on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://img.png" })
    mockImageToTextApi.mockResolvedValue({ text: "A cat" })
    await executeNode(makeNode("image-to-text", {}), makeCtx())
    expect(mockImageToTextApi).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// transcribe
// ---------------------------------------------------------------------------

describe("transcribe", () => {
  it("rejects when no audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("transcribe", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("sets running status on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    const promise = executeNode(makeNode("transcribe", {}), makeCtx())
    promise.catch(() => {})
    await new Promise((r) => setTimeout(r, 10))
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
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

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "jazz beat" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("suno-generate", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Generate",
      expect.anything(),
      expect.any(Function),
    )
  })
})

// ---------------------------------------------------------------------------
// suno-cover
// ---------------------------------------------------------------------------

describe("suno-cover", () => {
  it("rejects when no prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-cover", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      prompt: "cover this",
      audioUrl: "http://song.mp3",
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("suno-cover", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Cover",
      expect.anything(),
      expect.any(Function),
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

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ sunoTrackId: "track-123" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("suno-extend", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Extend",
      expect.anything(),
      expect.any(Function),
    )
  })
})

// ---------------------------------------------------------------------------
// suno-lyrics
// ---------------------------------------------------------------------------

describe("suno-lyrics", () => {
  it("rejects when no prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-lyrics", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No prompt")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("sets running status on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "love song" })
    const promise = executeNode(makeNode("suno-lyrics", {}), makeCtx())
    promise.catch(() => {})
    await new Promise((r) => setTimeout(r, 10))
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })
})

// ---------------------------------------------------------------------------
// suno-separate
// ---------------------------------------------------------------------------

describe("suno-separate", () => {
  it("rejects when no task ID", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-separate", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No task ID")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      sunoTaskId: "task-123",
      sunoTrackId: "track-123",
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("suno-separate", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Separate",
      expect.anything(),
      expect.any(Function),
    )
  })
})

// ---------------------------------------------------------------------------
// suno-music-video
// ---------------------------------------------------------------------------

describe("suno-music-video", () => {
  it("rejects when no taskId or audioId", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-music-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Missing taskId/audioId")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      sunoTaskId: "task-123",
      sunoTrackId: "track-123",
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("suno-music-video", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Music Video",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// merge-video-audio
// ---------------------------------------------------------------------------

describe("merge-video-audio", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("merge-video-audio", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
      audioSources: [{ url: "http://audio.mp3", sourceNodeId: "src1" }],
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("merge-video-audio", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Merge Video & Audio",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// trim-audio
// ---------------------------------------------------------------------------

describe("trim-audio", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("trim-audio", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("trim-audio", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Trim Audio",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// trim-video
// ---------------------------------------------------------------------------

describe("trim-video", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("trim-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("trim-video", { startTime: 0, endTime: 10 }),
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
  })
})

// ---------------------------------------------------------------------------
// transcode-video
// ---------------------------------------------------------------------------

describe("transcode-video", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("transcode-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("transcode-video", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedVideoUrl",
      "Transcode Video",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// speed-ramp
// ---------------------------------------------------------------------------

describe("speed-ramp", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("speed-ramp", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("speed-ramp", { speed: 2.0 }),
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
  })
})

// ---------------------------------------------------------------------------
// loop-video
// ---------------------------------------------------------------------------

describe("loop-video", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("loop-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("loop-video", { mode: "repeat", repeatCount: 3 }),
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
  })
})

// ---------------------------------------------------------------------------
// fade-video
// ---------------------------------------------------------------------------

describe("fade-video", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("fade-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("fade-video", {
        fadeIn: true,
        fadeInDuration: 1.0,
        fadeOut: false,
        fadeOutDuration: 0,
        color: "black",
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
  })
})

// ---------------------------------------------------------------------------
// resize-video
// ---------------------------------------------------------------------------

describe("resize-video", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("resize-video", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("resize-video", { targetAspect: "16:9" }),
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
    await expect(promise).rejects.toThrow()
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://audio.mp3" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("adjust-volume", { volume: 150 }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// add-captions
// ---------------------------------------------------------------------------

describe("add-captions", () => {
  it("rejects when no video", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("add-captions", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No video")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
      prompt: "Hello world",
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("add-captions", {}),
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
  })
})

// ---------------------------------------------------------------------------
// mix-audio
// ---------------------------------------------------------------------------

describe("mix-audio", () => {
  it("rejects when fewer than 2 audio tracks", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrls: ["http://a1.mp3"] })
    const promise = executeNode(
      makeNode("mix-audio", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Need at least 2 audio tracks")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrls: ["http://a1.mp3", "http://a2.mp3"],
      audioUrlsWithSourceIds: [
        { nodeId: "s1", url: "http://a1.mp3" },
        { nodeId: "s2", url: "http://a2.mp3" },
      ],
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("mix-audio", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Mix Audio",
      expect.anything(),
      undefined,
    )
  })
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

  it("calls generateAfterEffects on valid input", async () => {
    const vidNode = {
      id: "vid1",
      type: "image-to-video",
      data: { label: "V" },
    }
    mockNodes = [
      makeNode("after-effects", { effectPrompt: "cinematic look" }),
      vidNode,
    ]
    mockEdges = [{ id: "e1", source: "vid1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockExtractNodeOutput.mockReturnValue("http://vid.mp4")
    mockGenerateAfterEffects.mockResolvedValue({
      effectPlan: { effects: [] },
    })
    await executeNode(
      makeNode("after-effects", { effectPrompt: "cinematic look" }),
      makeCtx(),
    )
    expect(mockGenerateAfterEffects).toHaveBeenCalled()
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

  it("calls generateLottieOverlay on valid input", async () => {
    const vidNode = {
      id: "vid1",
      type: "image-to-video",
      data: { label: "V" },
    }
    mockNodes = [
      makeNode("lottie-overlay", { overlayPrompt: "add sparkles" }),
      vidNode,
    ]
    mockEdges = [
      { id: "e1", source: "vid1", target: "n1", targetHandle: "in" },
    ]
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    mockExtractNodeOutput.mockReturnValue("http://vid.mp4")
    mockGenerateLottieOverlay.mockResolvedValue({
      overlayPlan: { overlays: [] },
    })
    await executeNode(
      makeNode("lottie-overlay", { overlayPrompt: "add sparkles" }),
      makeCtx(),
    )
    expect(mockGenerateLottieOverlay).toHaveBeenCalled()
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

  it("calls generate3DTitle on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockGenerate3DTitle.mockResolvedValue({ titlePlan: { objects: [] } })
    await executeNode(
      makeNode("3d-title", { titlePrompt: "epic 3D title" }),
      makeCtx(),
    )
    expect(mockGenerate3DTitle).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// motion-graphics
// ---------------------------------------------------------------------------

describe("motion-graphics", () => {
  it("calls generateMotionGraphics and sets running status", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockGenerateMotionGraphics.mockResolvedValue({
      motionPlan: { elements: [] },
    })
    await executeNode(
      makeNode("motion-graphics", { motionPrompt: "lower third" }),
      makeCtx(),
    )
    expect(mockGenerateMotionGraphics).toHaveBeenCalled()
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("calls generateMotionGraphics on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockGenerateMotionGraphics.mockResolvedValue({
      motionPlan: { elements: [] },
    })
    await executeNode(
      makeNode("motion-graphics", { motionPrompt: "lower third" }),
      makeCtx(),
    )
    expect(mockGenerateMotionGraphics).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ai-writer
// ---------------------------------------------------------------------------

describe("ai-writer", () => {
  it("resolves without error when no systemPrompt (sets failed status)", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    await executeNode(
      makeNode("ai-writer", {}),
      makeCtx(),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "failed",
        errorMessage: "System prompt is required",
      }),
    )
  })

  it("calls generateAIWriterStream on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockGenerateAIWriterStream.mockResolvedValue({
      jobId: "j1",
      generatedText: "Hello world",
    })
    await executeNode(
      makeNode("ai-writer", {
        systemPrompt: "You are a writer",
        userInput: "Write something",
      }),
      makeCtx(),
    )
    expect(mockGenerateAIWriterStream).toHaveBeenCalled()
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

  it("calls pollJobWithNodeUpdate on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "rain sounds" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(makeNode("text-to-audio", {}), makeCtx())
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Text to Audio",
      expect.anything(),
      undefined,
    )
  })
})

// ---------------------------------------------------------------------------
// suno-mashup
// ---------------------------------------------------------------------------

describe("suno-mashup", () => {
  it("rejects when fewer than 2 audio inputs", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrls: ["http://a1.mp3"],
      audioUrl: "http://a1.mp3",
    })
    const promise = executeNode(
      makeNode("suno-mashup", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Need two audio inputs")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate with 2 audio inputs", async () => {
    mockResolveNodeInputs.mockReturnValue({
      audioUrl: "http://a1.mp3",
      audioUrl2: "http://a2.mp3",
    })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("suno-mashup", { model: "chirp-v4", style: "rock" }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Mashup",
      expect.anything(),
      expect.any(Function),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockSunoMashupApi).toHaveBeenCalledWith({
      uploadUrlList: ["http://a1.mp3", "http://a2.mp3"],
      model: "chirp-v4",
      customMode: false,
      style: "rock",
      title: undefined,
      negativeStyle: undefined,
      vocalGender: undefined,
      userId: "u1",
    })
  })
})

// ---------------------------------------------------------------------------
// suno-replace-section
// ---------------------------------------------------------------------------

describe("suno-replace-section", () => {
  it("rejects when no taskId/audioId", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-replace-section", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Missing taskId/audioId")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate with timing params", async () => {
    mockResolveNodeInputs.mockReturnValue({ sunoTaskId: "task-123", sunoTrackId: "audio-456" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("suno-replace-section", {
        infillStartS: 10,
        infillEndS: 25,
        prompt: "guitar solo",
        tags: "rock",
        title: "My Song",
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Replace Section",
      expect.anything(),
      expect.any(Function),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockSunoReplaceSectionApi).toHaveBeenCalledWith({
      taskId: "task-123",
      audioId: "audio-456",
      infillStartS: 10,
      infillEndS: 25,
      prompt: "guitar solo",
      tags: "rock",
      title: "My Song",
      userId: "u1",
    })
  })
})

// ---------------------------------------------------------------------------
// suno-style-boost
// ---------------------------------------------------------------------------

describe("suno-style-boost", () => {
  it("rejects when no content", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-style-boost", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No content")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls sunoStyleBoostApi with text content", async () => {
    mockResolveNodeInputs.mockReturnValue({ prompt: "pop lyrics about love" })
    mockSunoStyleBoostApi.mockResolvedValue({ text: "boosted pop lyrics" })
    await executeNode(
      makeNode("suno-style-boost", {}),
      makeCtx(),
    )
    expect(mockSunoStyleBoostApi).toHaveBeenCalledWith({
      content: "pop lyrics about love",
      userId: "u1",
    })
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedText: "boosted pop lyrics",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// suno-add-instrumental
// ---------------------------------------------------------------------------

describe("suno-add-instrumental", () => {
  it("rejects when no taskId/audioId", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-add-instrumental", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Missing taskId/audioId")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate with taskId/audioId and model", async () => {
    mockResolveNodeInputs.mockReturnValue({ sunoTaskId: "task-123", sunoTrackId: "audio-456" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("suno-add-instrumental", { model: "chirp-v4" }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Add Instrumental",
      expect.anything(),
      expect.any(Function),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockSunoAddInstrumentalApi).toHaveBeenCalledWith({
      taskId: "task-123",
      audioId: "audio-456",
      model: "chirp-v4",
      userId: "u1",
    })
  })
})

// ---------------------------------------------------------------------------
// suno-add-vocals
// ---------------------------------------------------------------------------

describe("suno-add-vocals", () => {
  it("rejects when no taskId/audioId", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-add-vocals", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Missing taskId/audioId")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate with taskId/audioId and model", async () => {
    mockResolveNodeInputs.mockReturnValue({ sunoTaskId: "task-123", sunoTrackId: "audio-456" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("suno-add-vocals", { model: "chirp-v4" }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Add Vocals",
      expect.anything(),
      expect.any(Function),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockSunoAddVocalsApi).toHaveBeenCalledWith({
      taskId: "task-123",
      audioId: "audio-456",
      model: "chirp-v4",
      userId: "u1",
    })
  })
})

// ---------------------------------------------------------------------------
// suno-convert-wav
// ---------------------------------------------------------------------------

describe("suno-convert-wav", () => {
  it("rejects when no taskId/audioId", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-convert-wav", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Missing taskId/audioId")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate with taskId/audioId", async () => {
    mockResolveNodeInputs.mockReturnValue({ sunoTaskId: "task-123", sunoTrackId: "audio-456" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("suno-convert-wav", {}),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Convert WAV",
      expect.anything(),
      expect.any(Function),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockSunoConvertWavApi).toHaveBeenCalledWith({
      taskId: "task-123",
      audioId: "audio-456",
      userId: "u1",
    })
  })
})

// ---------------------------------------------------------------------------
// suno-upload-extend
// ---------------------------------------------------------------------------

describe("suno-upload-extend", () => {
  it("rejects when no audio input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("suno-upload-extend", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No audio input")
    expect(mockToastError).toHaveBeenCalled()
  })

  it("calls pollJobWithNodeUpdate with audio input and params", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "http://clip.mp3" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
    await executeNode(
      makeNode("suno-upload-extend", {
        prompt: "extend the chorus",
        model: "chirp-v4",
        style: "pop",
        title: "My Song",
        continueAt: 60,
        defaultParamFlag: false,
      }),
      makeCtx(),
    )
    expect(mockPollJobWithNodeUpdate).toHaveBeenCalledWith(
      "n1",
      expect.any(Function),
      "generatedAudioUrl",
      "Suno Upload Extend",
      expect.anything(),
      expect.any(Function),
    )
    const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
    await apiCallFn()
    expect(mockSunoUploadExtendApi).toHaveBeenCalledWith({
      audioUrl: "http://clip.mp3",
      prompt: "extend the chorus",
      model: "chirp-v4",
      style: "pop",
      title: "My Song",
      negativeStyle: undefined,
      vocalGender: undefined,
      continueAt: 60,
      defaultParamFlag: false,
      userId: "u1",
    })
  })
})
