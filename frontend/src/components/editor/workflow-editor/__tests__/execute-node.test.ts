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
const mockDetectPreviewItemType = vi.fn()
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
const mockLlmChatStream = vi.fn()
const mockGetGenerateTextTemplate = vi.fn()
const mockImageToTextApi = vi.fn()
const mockTextToDialogueApi = vi.fn()
const mockVoiceChangerApi = vi.fn()
const mockDubbingApi = vi.fn()
const mockVoiceRemixApi = vi.fn()
const mockVoiceDesignApi = vi.fn()
const mockForcedAlignmentApi = vi.fn()
const mockSaveToStorageApi = vi.fn()
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
  llmChatStream: (...args: unknown[]) => mockLlmChatStream(...args),
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
  saveToStorageApi: (...args: unknown[]) => mockSaveToStorageApi(...args),
  transcribeApi: vi.fn(),
  downloadYouTubeAudio: vi.fn(),
  lipSyncApi: vi.fn(),
  speechToVideoApi: vi.fn(),
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
  getGenerateTextTemplate: (...args: unknown[]) =>
    mockGetGenerateTextTemplate(...args),
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: () => "scene prompt",
}))

vi.mock("../node-input-resolver", () => ({
  resolveNodeInputs: (...args: unknown[]) => mockResolveNodeInputs(...args),
  // Phase E3/3 — object branch calls this to compose seedPromptHint from
  // upstream picker nodes wired to the `type` handle. Default to "" so the
  // generic object test path (no picker wired) still passes.
  resolveSeedPromptHint: vi.fn(() => ""),
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: (...args: unknown[]) => mockExtractNodeOutput(...args),
  detectPreviewItemType: (...args: unknown[]) => mockDetectPreviewItemType(...args),
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
  mockDetectPreviewItemType.mockImplementation((_nodeType: string, value?: string) => {
    if (!value) return "text"
    if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(value)) return "image"
    if (/\.(mp4|mov|webm)$/i.test(value)) return "video"
    if (/\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(value)) return "audio"
    return "text"
  })
  mockResolveNodeInputs.mockReturnValue({})
  mockCollectAncestorRefs.mockReturnValue([])
})

// ---------------------------------------------------------------------------
// Manual edit bridge
// ---------------------------------------------------------------------------

describe("manual-edit bridge", () => {
  it("resolveManualEdit resolves a pending manual-edit promise", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    const promise = executeNode(makeNode("manual-edit", { mode: "wait" }), makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ inputVideoUrl: "http://vid.mp4" }),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "awaiting-user" }),
    )
    resolveManualEdit("n1")
    await promise
  })

  it("rejectManualEdit rejects a pending manual-edit promise", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    const promise = executeNode(makeNode("manual-edit", { mode: "wait" }), makeCtx())
    promise.catch(() => {})
    rejectManualEdit("n1", new Error("cancelled"))
    await expect(promise).rejects.toThrow("cancelled")
  })

  it("rejectAllManualEdits rejects all pending manual edits", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "http://vid.mp4" })
    const p1 = executeNode(
      { ...makeNode("manual-edit", { mode: "wait" }), id: "a1" },
      makeCtx(),
    )
    const p2 = executeNode(
      { ...makeNode("manual-edit", { mode: "wait" }), id: "a2" },
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
// preview
// ---------------------------------------------------------------------------

describe("preview", () => {
  it("collects handle-specific outputs and preserves duplicate source nodes by handle", async () => {
    const previewNode = {
      id: "preview_1",
      type: "preview",
      position: { x: 0, y: 0 },
      data: { label: "preview", previewItems: [], itemOrder: [] },
    } as any

    mockNodes = [
      {
        id: "sub_1",
        type: "sub-workflow",
        position: { x: 0, y: 0 },
        data: { label: "Sub Workflow" },
      },
      previewNode,
    ]
    mockEdges = [
      { id: "e1", source: "sub_1", target: "preview_1", sourceHandle: "out_img" },
      { id: "e2", source: "sub_1", target: "preview_1", sourceHandle: "out_txt" },
    ] as any

    mockExtractNodeOutput.mockImplementation((node: any, sourceHandle?: string) => {
      if (node.id !== "sub_1") return undefined
      if (sourceHandle === "out_img") return "https://cdn.example.com/image.png"
      if (sourceHandle === "out_txt") return "hello world"
      return undefined
    })
    mockDetectPreviewItemType.mockImplementation((_nodeType: string, value?: string, sourceHandle?: string) => {
      if (sourceHandle === "out_img") return "image"
      if (sourceHandle === "out_txt") return "text"
      return value?.startsWith("https://") ? "image" : "text"
    })

    await expect(executeNode(previewNode, makeCtx())).resolves.toBe("")

    expect(mockExtractNodeOutput).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub_1" }),
      "out_img",
    )
    expect(mockExtractNodeOutput).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub_1" }),
      "out_txt",
    )
    expect(mockDetectPreviewItemType).toHaveBeenCalledWith(
      "sub-workflow",
      "https://cdn.example.com/image.png",
      "out_img",
    )
    expect(mockDetectPreviewItemType).toHaveBeenCalledWith(
      "sub-workflow",
      "hello world",
      "out_txt",
    )
    expect(mockUpdateNodeData).toHaveBeenLastCalledWith(
      "preview_1",
      expect.objectContaining({
        executionStatus: "completed",
        itemOrder: ["sub_1:out_img", "sub_1:out_txt"],
        previewItems: [
          expect.objectContaining({
            itemKey: "sub_1:out_img",
            sourceNodeId: "sub_1",
            sourceHandle: "out_img",
            value: "https://cdn.example.com/image.png",
          }),
          expect.objectContaining({
            itemKey: "sub_1:out_txt",
            sourceNodeId: "sub_1",
            sourceHandle: "out_txt",
            value: "hello world",
          }),
        ],
      }),
    )
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
      "nano-banana-pro",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      // identity — undefined when no upstream Character has
      // injectIdentityInPrompts enabled.
      undefined,
      // internalLora (trailing arg) — undefined when no wired trained character.
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
      "nano-banana-pro",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      // identity.
      undefined,
      // internalLora (trailing arg).
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

  it("resolves @character:N:variant mentions when a Character is wired upstream", async () => {
    // Parity test with image-to-image — same user scenario. generate-image
    // already built connectedReferences inline before the fix, so this test
    // documents the parity expectation between the two node-type branches.
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/laughing.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [
          { name: "smile", url: "http://shira/smile.png" },
          { name: "laughing", url: "http://shira/laughing.png" },
        ],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const genNode = makeNode("generate-image", {
      prompt: "@shira:1:smile with friend, @shira:2:laughing laughs at a joke",
      provider: "nano-banana-pro",
    })
    mockNodes = [shiraNode, genNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://shira/portrait.png"],
    })
    mockRunImageGeneration.mockResolvedValue(undefined)
    mockCollectAncestorRefs.mockReturnValue([])

    await executeNode(genNode as any, makeCtx())

    const callArgs = mockRunImageGeneration.mock.calls[0]
    const passedPrompt = callArgs[1] as string
    const passedRefs = callArgs[3] as string[] | undefined

    expect(passedRefs).toBeDefined()
    expect(passedRefs).toContain("http://shira/smile.png")
    expect(passedRefs).toContain("http://shira/laughing.png")
    // Canonical NOT in refs because shira was @-mentioned.
    expect(passedRefs).not.toContain("http://shira/portrait.png")
    expect(passedPrompt).not.toMatch(/@shira:1:smile\b/)
    expect(passedPrompt).not.toMatch(/@shira:2:laughing\b/)
  })

  it("allows empty user prompt when a wired Character fills the assembled prompt (canonical fallback)", async () => {
    // User scenario: a Character node "kira" is wired into a generate-image
    // node, but the user typed NOTHING in the prompt field. The pre-fix code
    // rejected this with "no prompt — type one or connect a cinematography
    // source", but a wired Character contributes a canonical URL + identity
    // directive via Phase 0 in `buildImagePrompt`. The assembled prompt has
    // plenty of content even with empty user input — so the node should run.
    const kiraNode = {
      id: "char-kira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "kira",
        characterName: "kira",
        sourceImageUrl: "http://kira/portrait.png",
        defaultAssetUrl: "http://kira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [{ name: "smile", url: "http://kira/smile.png" }],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    // No prompt — user typed nothing.
    const genNode = makeNode("generate-image", { provider: "nano-banana-pro" })
    mockNodes = [kiraNode, genNode]
    mockEdges = [{ source: "char-kira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://kira/portrait.png"],
    })
    mockRunImageGeneration.mockResolvedValue(undefined)
    mockCollectAncestorRefs.mockReturnValue([])

    // Should NOT throw — the assembled prompt has the canonical fallback block.
    await executeNode(genNode as any, makeCtx())

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockRunImageGeneration).toHaveBeenCalled()
    const callArgs = mockRunImageGeneration.mock.calls[0]
    const passedPrompt = callArgs[1] as string
    // Canonical fallback directive must appear in the assembled prompt.
    expect(passedPrompt).toContain("kira")
    expect(passedPrompt).toContain("The subject must remain exactly the same person")
    expect(passedPrompt).toContain("young woman, brown eyes")
  })

  it("allows empty user prompt with @-mention when a Character is wired upstream", async () => {
    // Variant of the canonical fallback test: user typed only "@kira:1:smile"
    // (no other words). The assembled prompt has identity directives even
    // though the literal user input has no descriptive content.
    const kiraNode = {
      id: "char-kira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "kira",
        characterName: "kira",
        sourceImageUrl: "http://kira/portrait.png",
        defaultAssetUrl: "http://kira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [{ name: "smile", url: "http://kira/smile.png" }],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const genNode = makeNode("generate-image", {
      prompt: "@kira:1:smile",
      provider: "nano-banana-pro",
    })
    mockNodes = [kiraNode, genNode]
    mockEdges = [{ source: "char-kira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://kira/portrait.png"],
    })
    mockRunImageGeneration.mockResolvedValue(undefined)
    mockCollectAncestorRefs.mockReturnValue([])

    await executeNode(genNode as any, makeCtx())

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockRunImageGeneration).toHaveBeenCalled()
    const callArgs = mockRunImageGeneration.mock.calls[0]
    const passedPrompt = callArgs[1] as string
    // Literal mention must be replaced.
    expect(passedPrompt).not.toMatch(/@kira:1:smile\b/)
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

  it("resolves @character:N:variant mentions when a Character is wired upstream (bug fix)", async () => {
    // User scenario: a Character node "shira" wired upstream of image-to-image.
    // shira has expressions "smile" and "laughing", and defaultAssetUrl set to
    // the "laughing" URL via the studio's ★ button. User types the prompt:
    //   "@shira:1:smile with friend, @shira:2:laughing laughs at a joke"
    // Expected: BOTH smile + laughing variant URLs attach as referenceImageUrls,
    // and the literal @-mention tokens are replaced by the resolved directives.
    //
    // Before the fix, the i2i path called `buildImagePrompt` WITHOUT a
    // `connectedReferences` array, so Phase 0 mention resolution never fired
    // and the @-mention tokens stayed in the prompt verbatim with NO variant
    // URLs attached.
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/laughing.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [
          { name: "smile", url: "http://shira/smile.png" },
          { name: "laughing", url: "http://shira/laughing.png" },
        ],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const i2iNode = makeNode("image-to-image", {
      prompt: "@shira:1:smile with friend, @shira:2:laughing laughs at a joke",
      provider: "nano-banana",
    })
    mockNodes = [shiraNode, i2iNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    // The input resolver pushes shira's URL into inputs.referenceImageUrls.
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://shira/portrait.png"],
    })
    mockRunImageToImage.mockResolvedValue(undefined)

    await executeNode(i2iNode as any, makeCtx())

    // shira's portrait becomes the main `imageUrl` (first wired image is the
    // i2i input). The variant URLs must appear as `referenceImageUrls`.
    const callArgs = mockRunImageToImage.mock.calls[0]
    const passedImageUrl = callArgs[1] as string
    const passedPrompt = callArgs[2] as string
    const passedRefs = callArgs[5] as string[] | undefined

    expect(passedImageUrl).toBe("http://shira/portrait.png")
    expect(passedRefs).toBeDefined()
    expect(passedRefs).toContain("http://shira/smile.png")
    expect(passedRefs).toContain("http://shira/laughing.png")
    // Canonical NOT attached because the character was @-mentioned.
    // (Phase 0's per-character contract: mentioned → only mentioned variants).
    // The portrait URL IS still passed as the main imageUrl, but should NOT
    // appear in the references list.
    expect(passedRefs).not.toContain("http://shira/portrait.png")
    // Literal @-mention tokens were replaced — they must not survive into the
    // final prompt verbatim.
    expect(passedPrompt).not.toMatch(/@shira:1:smile\b/)
    expect(passedPrompt).not.toMatch(/@shira:2:laughing\b/)
    // Only the FIRST mention of a character emits a directive (existing dedup
    // behavior in resolveCharacterMentions). With two `@shira:N:variant`
    // tokens, only `Image 1 (shira)` is emitted.
    expect(passedPrompt).toContain("Image 1 (shira)")
  })

  it("attaches canonical fallback when a Character is wired upstream WITHOUT any @-mention", async () => {
    // Canonical fallback behavior: even when the user types no @-mention, a
    // wired Character still contributes its canonical URL + a strong identity
    // directive (mirrors the pre-mention-feature auto-attach behavior). Per
    // i2i semantics, the canonical URL is consumed as the main imageUrl, so
    // referenceImageUrls is empty here — but the directive must appear in the
    // prompt.
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/laughing.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [{ name: "smile", url: "http://shira/smile.png" }],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const i2iNode = makeNode("image-to-image", {
      prompt: "make her dance in the rain",
      provider: "nano-banana",
    })
    mockNodes = [shiraNode, i2iNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://shira/portrait.png"],
    })
    mockRunImageToImage.mockResolvedValue(undefined)

    await executeNode(i2iNode as any, makeCtx())

    const callArgs = mockRunImageToImage.mock.calls[0]
    const passedPrompt = callArgs[2] as string

    // Canonical fallback directive must appear in the prompt.
    expect(passedPrompt).toContain("shira")
    expect(passedPrompt).toContain("The subject must remain exactly the same person")
    expect(passedPrompt).toContain("young woman, brown eyes")
  })

  it("allows empty user prompt when a wired Character fills the assembled prompt (canonical fallback)", async () => {
    // Empty user prompt + wired Character → canonical fallback fills the
    // assembled prompt. The pre-fix code rejected with "transformation prompt
    // is required" before `buildImagePrompt` ran. Now the check runs AFTER
    // assembly, so a wired Character can supply the prompt entirely.
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [{ name: "smile", url: "http://shira/smile.png" }],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    // No prompt — user typed nothing.
    const i2iNode = makeNode("image-to-image", { provider: "nano-banana" })
    mockNodes = [shiraNode, i2iNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://input.png",
      referenceImageUrls: ["http://shira/portrait.png"],
    })
    mockRunImageToImage.mockResolvedValue(undefined)

    await executeNode(i2iNode as any, makeCtx())

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockRunImageToImage).toHaveBeenCalled()
    const callArgs = mockRunImageToImage.mock.calls[0]
    const passedPrompt = callArgs[2] as string
    expect(passedPrompt).toContain("shira")
    expect(passedPrompt).toContain("The subject must remain exactly the same person")
    expect(passedPrompt).toContain("young woman, brown eyes")
  })

  it("rejects when user prompt is empty AND no character/cinematography wired", async () => {
    // Negative case: with no wired Character, no @-mention, no cinematography,
    // and an empty user prompt, the assembled prompt is empty — so the
    // post-assembly check must still reject. Guards against the fix loosening
    // the check too much.
    mockResolveNodeInputs.mockReturnValue({
      imageUrl: "http://img.png",
    })
    const promise = executeNode(
      makeNode("image-to-image", { provider: "nano-banana" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow(
      "Transformation prompt is required",
    )
    expect(mockToastError).toHaveBeenCalled()
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
      {
        referenceVideoUrls: undefined,
        referenceAudioUrls: undefined,
        webSearch: undefined,
        nsfwChecker: undefined,
      },
    )
  })

  it("resolves @character:N:variant mentions when a Character is wired upstream", async () => {
    // Frontend = backend parity test. User scenario: a Character node "shira"
    // wired upstream of image-to-video, with smile + laughing expressions.
    // Prompt: "@shira:1:smile @shira:2:laughing dancing".
    // Expected: smile URL slots as startFrame (no upstream frame wired), laughing
    // URL appears in referenceImageUrls, prompt has the resolved directive block.
    // Mirrors the orchestrator's `resolveVideoPromptMentions` behavior so single-
    // node frontend execution matches workflow-orchestrator output exactly.
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [
          { name: "smile", url: "http://shira/smile.png" },
          { name: "laughing", url: "http://shira/laughing.png" },
        ],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const i2vNode = makeNode("image-to-video", {
      prompt: "@shira:1:smile @shira:2:laughing dancing",
    })
    mockNodes = [shiraNode, i2vNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    // The input resolver pushes shira's URL into inputs.referenceImageUrls.
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://shira/portrait.png"],
    })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(i2vNode as any, makeCtx())

    const callArgs = mockRunVideoGeneration.mock.calls[0]
    const passedStartFrame = callArgs[1] as string
    const passedPrompt = callArgs[8] as string
    const passedRefs = callArgs[22] as string[] | undefined

    // First mention URL becomes the start frame (no upstream frame was wired).
    expect(passedStartFrame).toBe("http://shira/smile.png")
    // Second mention URL appears in referenceImageUrls alongside upstream URL.
    expect(passedRefs).toBeDefined()
    expect(passedRefs).toContain("http://shira/laughing.png")
    // The literal @-mention tokens are replaced.
    expect(passedPrompt).not.toMatch(/@shira:1:smile\b/)
    expect(passedPrompt).not.toMatch(/@shira:2:laughing\b/)
    // Only the FIRST mention emits a directive (dedup in resolveCharacterMentions).
    expect(passedPrompt).toContain("Image 1 (shira)")
  })

  it("attaches canonical fallback when a Character is wired upstream WITHOUT any @-mention", async () => {
    // Canonical fallback parity test: without any @-mention, the wired
    // Character contributes its canonical URL + identity directive (mirrors
    // the pre-mention auto-attach behavior + the backend orchestrator).
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [{ name: "smile", url: "http://shira/smile.png" }],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const i2vNode = makeNode("image-to-video", {
      prompt: "make her dance in the rain",
    })
    mockNodes = [shiraNode, i2vNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://shira/portrait.png"],
    })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(i2vNode as any, makeCtx())

    const callArgs = mockRunVideoGeneration.mock.calls[0]
    const passedStartFrame = callArgs[1] as string
    const passedPrompt = callArgs[8] as string

    // Canonical URL fills the start frame slot (no other source).
    expect(passedStartFrame).toBe("http://shira/portrait.png")
    // Canonical fallback directive must appear in the prompt.
    expect(passedPrompt).toContain("shira")
    expect(passedPrompt).toContain("The subject must remain exactly the same person")
    expect(passedPrompt).toContain("young woman, brown eyes")
  })

  it("allows empty user prompt when a wired Character supplies the canonical fallback", async () => {
    // Empty user prompt + wired Character → canonical fallback fills the
    // assembled prompt. `resolveVideoPromptMentions` now handles
    // empty/undefined prompts and applies canonical fallback regardless,
    // so an i2v node with only a wired Character (no typed text) still runs.
    const kiraNode = {
      id: "char-kira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "kira",
        characterName: "kira",
        sourceImageUrl: "http://kira/portrait.png",
        defaultAssetUrl: "http://kira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [{ name: "smile", url: "http://kira/smile.png" }],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const i2vNode = makeNode("image-to-video", {}) // No prompt
    mockNodes = [kiraNode, i2vNode]
    mockEdges = [{ source: "char-kira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      // Provide a start frame so the i2v node has its required input.
      imageUrl: "http://input-frame.png",
    })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(i2vNode as any, makeCtx())

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockRunVideoGeneration).toHaveBeenCalled()
    const callArgs = mockRunVideoGeneration.mock.calls[0]
    const passedPrompt = callArgs[8] as string
    // Canonical fallback directive must appear even though user typed nothing.
    expect(passedPrompt).toContain("kira")
    expect(passedPrompt).toContain("The subject must remain exactly the same person")
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

  it("resolves @character:N:variant mentions when a Character is wired upstream", async () => {
    // Frontend = backend parity test. v2v has only a single `referenceImageUrl`
    // slot, so only the first resolved mention URL fills it (extras dropped,
    // matching backend payload-builder.ts v2v handling).
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [
          { name: "smile", url: "http://shira/smile.png" },
        ],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const v2vNode = makeNode("video-to-video", {
      prompt: "@shira:1:smile waving",
    })
    mockNodes = [shiraNode, v2vNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
      // No upstream referenceImageUrls so the mention URL fills the slot.
    })
    mockRunVideoToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(v2vNode as any, makeCtx())

    const callArgs = mockRunVideoToVideoGeneration.mock.calls[0]
    const passedPrompt = callArgs[3] as string
    const passedOptions = callArgs[5] as { referenceImageUrl?: string }

    // First mention URL becomes the single referenceImageUrl.
    expect(passedOptions.referenceImageUrl).toBe("http://shira/smile.png")
    // Literal token replaced.
    expect(passedPrompt).not.toMatch(/@shira:1:smile\b/)
    expect(passedPrompt).toContain("Image 1 (shira)")
  })

  it("attaches canonical fallback when a Character is wired upstream WITHOUT any @-mention", async () => {
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const v2vNode = makeNode("video-to-video", {
      prompt: "make her wave",
    })
    mockNodes = [shiraNode, v2vNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      videoUrl: "http://vid.mp4",
    })
    mockRunVideoToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(v2vNode as any, makeCtx())

    const callArgs = mockRunVideoToVideoGeneration.mock.calls[0]
    const passedPrompt = callArgs[3] as string
    const passedOptions = callArgs[5] as { referenceImageUrl?: string }

    // Canonical URL fills the single referenceImageUrl slot (no other source).
    expect(passedOptions.referenceImageUrl).toBe("http://shira/portrait.png")
    expect(passedPrompt).toContain("shira")
    expect(passedPrompt).toContain("The subject must remain exactly the same person")
    expect(passedPrompt).toContain("young woman, brown eyes")
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
      "seedance-2-fast",
      expect.objectContaining({
        duration: undefined,
        // Seedance 2 silently defaults to 16:9 when data.aspectRatio is unset
        aspectRatio: "16:9",
        // Default resolution = lowest available tier from MODEL_CATALOG
        // (per #2453). For seedance-2-fast that's "480p".
        resolution: "480p",
        generateAudio: true,
      }),
    )
  })

  it("resolves @character:N:variant mentions when a Character is wired upstream", async () => {
    // Frontend = backend parity test. t2v has no `imageUrl` slot — all
    // resolved URLs become entries in referenceImageUrls, merged with whatever
    // upstream already provided. Mirrors backend payload-builder.ts t2v.
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [
          { name: "smile", url: "http://shira/smile.png" },
          { name: "laughing", url: "http://shira/laughing.png" },
        ],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const t2vNode = makeNode("text-to-video", {
      prompt: "@shira:1:smile @shira:2:laughing dancing",
    })
    mockNodes = [shiraNode, t2vNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://shira/portrait.png"],
    })
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode as any, makeCtx())

    const callArgs = mockRunTextToVideoGeneration.mock.calls[0]
    const passedPrompt = callArgs[1] as string
    const passedOptions = callArgs[4] as { referenceImageUrls?: string[] }

    // Both mention URLs appear in referenceImageUrls (merged with upstream).
    expect(passedOptions.referenceImageUrls).toBeDefined()
    expect(passedOptions.referenceImageUrls).toContain("http://shira/smile.png")
    expect(passedOptions.referenceImageUrls).toContain("http://shira/laughing.png")
    // Literal tokens replaced + directive emitted.
    expect(passedPrompt).not.toMatch(/@shira:1:smile\b/)
    expect(passedPrompt).not.toMatch(/@shira:2:laughing\b/)
    expect(passedPrompt).toContain("Image 1 (shira)")
  })

  it("attaches canonical fallback when a Character is wired upstream WITHOUT any @-mention", async () => {
    const shiraNode = {
      id: "char-shira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "shira",
        characterName: "shira",
        sourceImageUrl: "http://shira/portrait.png",
        defaultAssetUrl: "http://shira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    const t2vNode = makeNode("text-to-video", {
      prompt: "make her dance in the rain",
    })
    mockNodes = [shiraNode, t2vNode]
    mockEdges = [{ source: "char-shira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({
      referenceImageUrls: ["http://shira/portrait.png"],
    })
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode as any, makeCtx())

    const callArgs = mockRunTextToVideoGeneration.mock.calls[0]
    const passedPrompt = callArgs[1] as string
    const passedOptions = callArgs[4] as { referenceImageUrls?: string[] }

    // Canonical fallback directive must appear in the prompt.
    expect(passedPrompt).toContain("shira")
    expect(passedPrompt).toContain("The subject must remain exactly the same person")
    expect(passedPrompt).toContain("young woman, brown eyes")
    // Canonical URL already in upstream refs, no dup.
    expect(passedOptions.referenceImageUrls).toBeDefined()
    expect(passedOptions.referenceImageUrls).toContain("http://shira/portrait.png")
  })

  it("allows empty user prompt when a wired Character supplies the canonical fallback", async () => {
    // Empty user prompt + wired Character → canonical fallback fills the
    // assembled prompt. Pre-fix code rejected with "no prompt" before mention
    // resolution ran. Now the check runs AFTER mention resolution +
    // canonical-fallback assembly, so an empty typed prompt still runs.
    const kiraNode = {
      id: "char-kira",
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "kira",
        characterName: "kira",
        sourceImageUrl: "http://kira/portrait.png",
        defaultAssetUrl: "http://kira/portrait.png",
        canonicalDescription: "young woman, brown eyes",
        expressions: [],
        poses: [],
        motions: [],
        angles: [],
        bodyAngles: [],
        lightingVariations: [],
      },
    }
    // No prompt — user typed nothing.
    const t2vNode = makeNode("text-to-video", {})
    mockNodes = [kiraNode, t2vNode]
    mockEdges = [{ source: "char-kira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode as any, makeCtx())

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockRunTextToVideoGeneration).toHaveBeenCalled()
    const callArgs = mockRunTextToVideoGeneration.mock.calls[0]
    const passedPrompt = callArgs[1] as string
    expect(passedPrompt).toContain("kira")
    expect(passedPrompt).toContain("The subject must remain exactly the same person")
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

  it("calls runObjectGeneration with data + Phase E3/3 extras", async () => {
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
      expect.objectContaining({
        attachName: "Sword",
        count: 1,
        // attachToObjectId / seedPromptHint / expectedUpdatedAt are
        // undefined when the canvas has no prior bind + no upstream
        // picker — the route's Zod schema accepts undefined.
        attachToObjectId: undefined,
        seedPromptHint: undefined,
      }),
    )
  })

  it("passes attachToObjectId + expectedUpdatedAt when set on the node", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockRunObjectGeneration.mockResolvedValue(undefined)
    await executeNode(
      makeNode("object", {
        objectName: "Excalibur",
        objectDbId: "obj-uuid-123",
        updatedAt: "2026-05-21T10:00:00.000Z",
      }),
      makeCtx(),
    )
    expect(mockRunObjectGeneration).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ objectName: "Excalibur" }),
      expect.anything(),
      expect.objectContaining({
        attachToObjectId: "obj-uuid-123",
        attachName: "Excalibur",
        expectedUpdatedAt: "2026-05-21T10:00:00.000Z",
        count: 1,
      }),
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
  it("sets splitResults and __listResults (legacy ===NEXT=== literal)", async () => {
    const sourceNode = {
      id: "src1",
      type: "ai-writer",
      data: { label: "W" },
    }
    mockNodes = [makeNode("split-text", { separator: "===NEXT===" }), sourceNode]
    mockEdges = [{ id: "e1", source: "src1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue(
      "part one===NEXT===part two===NEXT===part three",
    )
    await executeNode(makeNode("split-text", { separator: "===NEXT===" }), makeCtx())
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

  it("splits by newline preset (default)", async () => {
    const sourceNode = {
      id: "src1",
      type: "ai-writer",
      data: { label: "W" },
    }
    mockNodes = [makeNode("split-text", { separator: "newline" }), sourceNode]
    mockEdges = [{ id: "e1", source: "src1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue("line1\nline2\nline3")
    await executeNode(makeNode("split-text", { separator: "newline" }), makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        splitResults: ["line1", "line2", "line3"],
        __listTotal: 3,
        executionStatus: "completed",
      }),
    )
  })

  it("splits by stars preset", async () => {
    const sourceNode = { id: "src1", type: "ai-writer", data: { label: "W" } }
    mockNodes = [makeNode("split-text", { separator: "stars" }), sourceNode]
    mockEdges = [{ id: "e1", source: "src1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue("a***b***c")
    await executeNode(makeNode("split-text", { separator: "stars" }), makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        splitResults: ["a", "b", "c"],
        __listTotal: 3,
      }),
    )
  })

  it("splits by custom delimiter via customSeparator field", async () => {
    const sourceNode = { id: "src1", type: "ai-writer", data: { label: "W" } }
    mockNodes = [
      makeNode("split-text", { separator: "custom", customSeparator: "###" }),
      sourceNode,
    ]
    mockEdges = [{ id: "e1", source: "src1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue("a###b###c")
    await executeNode(
      makeNode("split-text", { separator: "custom", customSeparator: "###" }),
      makeCtx(),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        splitResults: ["a", "b", "c"],
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
    mockNodes = [makeNode("split-text", { separator: "===NEXT===" }), sourceNode]
    mockEdges = [{ id: "e1", source: "src1", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue(
      "  part one  ===NEXT===   ===NEXT===  part two  ",
    )
    await executeNode(makeNode("split-text", { separator: "===NEXT===" }), makeCtx())
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
      expect.any(Array),
      undefined, // audioCrossfadeCurve — unset on this node
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
// save-to-storage
// ---------------------------------------------------------------------------

describe("save-to-storage", () => {
  it("rejects when no media input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(
      makeNode("save-to-storage", {}),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).resolves.toBe("")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed", errorMessage: "No media input connected" }),
    )
  })

  it("passes the resolved mediaType for extension-less video URLs", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: "https://cdn.example.com/media" })
    mockSaveToStorageApi.mockResolvedValue({ jobId: "job-1", url: "https://r2.example.com/video" })

    await executeNode(makeNode("save-to-storage", { filename: "clip.mp4" }), makeCtx())

    expect(mockSaveToStorageApi).toHaveBeenCalledWith({
      mediaUrl: "https://cdn.example.com/media",
      filename: "clip.mp4",
      mediaType: "video",
    })
  })

  it("passes audio mediaType when the source is audio-only", async () => {
    mockResolveNodeInputs.mockReturnValue({ audioUrl: "https://cdn.example.com/stream" })
    mockSaveToStorageApi.mockResolvedValue({ jobId: "job-2", url: "https://r2.example.com/audio" })

    await executeNode(makeNode("save-to-storage", {}), makeCtx())

    expect(mockSaveToStorageApi).toHaveBeenCalledWith({
      mediaUrl: "https://cdn.example.com/stream",
      filename: undefined,
      mediaType: "audio",
    })
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

// NOTE: the standalone `ai-writer` execute block was folded into `llm-chat`
// (Generate Text merge, Task 12). The `ai-writer` node type still exists in
// types.ts until T18 and saved nodes are migrated to `llm-chat` on load (T17),
// so no `ai-writer`-typed node reaches `executeNode` in the merged state. These
// former ai-writer execution tests are migrated to `llm-chat` below.
describe("llm-chat", () => {
  it("rejects when no user prompt", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    const promise = executeNode(makeNode("llm-chat", {}), makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No user prompt")
    expect(mockLlmChatStream).not.toHaveBeenCalled()
  })

  it("calls llmChatStream on valid input", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockLlmChatStream.mockResolvedValue({
      jobId: "j1",
      generatedText: "Hello world",
    })
    await executeNode(
      makeNode("llm-chat", {
        userInput: "Write something",
      }),
      makeCtx(),
    )
    expect(mockLlmChatStream).toHaveBeenCalled()
  })

  it("rejects (no llmChatStream) when template.requiresImageRef and no image source connected", async () => {
    mockGetGenerateTextTemplate.mockReturnValue({
      id: "photo-shoot",
      label: "Photo Shoot Planner",
      systemPrompt: "",
      requiresImageRef: true,
    })
    mockResolveNodeInputs.mockReturnValue({})
    mockNodes = [makeNode("llm-chat", { templateId: "photo-shoot", userInput: "go" })]
    mockEdges = []
    const promise = executeNode(
      makeNode("llm-chat", { templateId: "photo-shoot", userInput: "go" }),
      makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("No reference image connected")
    expect(mockToastError).toHaveBeenCalled()
    expect(mockLlmChatStream).not.toHaveBeenCalled()
  })

  it("proceeds when custom template (no requiresImageRef) and no image source", async () => {
    mockGetGenerateTextTemplate.mockReturnValue({
      id: "custom",
      label: "Custom",
      systemPrompt: "",
    })
    mockResolveNodeInputs.mockReturnValue({})
    mockLlmChatStream.mockResolvedValue({ jobId: "j1", generatedText: "ok" })
    await executeNode(
      makeNode("llm-chat", { templateId: "custom", userInput: "go" }),
      makeCtx(),
    )
    expect(mockLlmChatStream).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("proceeds when a non-custom template has requiresImageRef:false and no image source (locks the requiresImageRef gate, not id!=='custom')", async () => {
    // A user-defined template (random-UUID id, no requiresImageRef) — the T15
    // "Save as template" shape. Under the old `id !== "custom"` guard this would
    // be WRONGLY rejected; under `requiresImageRef` it must run.
    mockGetGenerateTextTemplate.mockReturnValue({
      id: "user-tpl-7f3a",
      label: "My Saved Prompt",
      systemPrompt: "",
      requiresImageRef: false,
    })
    mockResolveNodeInputs.mockReturnValue({})
    mockLlmChatStream.mockResolvedValue({ jobId: "j1", generatedText: "ok" })
    mockNodes = [makeNode("llm-chat", { templateId: "user-tpl-7f3a", userInput: "go" })]
    mockEdges = []
    await executeNode(
      makeNode("llm-chat", { templateId: "user-tpl-7f3a", userInput: "go" }),
      makeCtx(),
    )
    expect(mockLlmChatStream).toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("sets generatedItems from the ===NEXT=== split on completion", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockLlmChatStream.mockResolvedValue({
      jobId: "j1",
      generatedText: "one===NEXT===two===NEXT===three",
    })
    await executeNode(
      makeNode("llm-chat", { userInput: "go" }),
      makeCtx(),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedItems: ["one", "two", "three"],
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
      // Route schema requires `uploadUrl` (not legacy `audioUrl`) and numeric
      // `continueAt`; reshaped in fix/dag-execution-parity.
      uploadUrl: "http://clip.mp3",
      continueAt: 60,
      prompt: "extend the chorus",
      model: "chirp-v4",
      style: "pop",
      title: "My Song",
      negativeStyle: undefined,
      vocalGender: undefined,
      defaultParamFlag: false,
      userId: "u1",
    })
  })
})
