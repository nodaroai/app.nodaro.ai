import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock variables (declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockExecuteReduce = vi.fn()
const mockResolveNodeInputs = vi.fn()
const mockExtractNodeOutput = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []

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
      characterDefinitions: [],
      userPromptTemplates: {},
      flowPromptTemplates: {},
    }),
  },
}))

vi.mock("@/lib/api", () => ({
  executeReduce: (...args: unknown[]) => mockExecuteReduce(...args),
  // unrelated stubs needed for import
  generateImage: vi.fn(),
  getJobStatusLean: vi.fn(),
  generateAIWriterStream: vi.fn(),
  generateSceneGraph: vi.fn(),
  generateAfterEffects: vi.fn(),
  generateLottieOverlay: vi.fn(),
  generate3DTitle: vi.fn(),
  generateMotionGraphics: vi.fn(),
  renderVideoWithSceneGraph: vi.fn(),
  renderVideoWithPlan: vi.fn(),
  imageToTextApi: vi.fn(),
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
  textToDialogueApi: vi.fn(),
  voiceChangerApi: vi.fn(),
  dubbingApi: vi.fn(),
  voiceRemixApi: vi.fn(),
  voiceDesignApi: vi.fn(),
  forcedAlignmentApi: vi.fn(),
  saveToStorageApi: vi.fn(),
  transcribeApi: vi.fn(),
  downloadYouTubeAudio: vi.fn(),
  lipSyncApi: vi.fn(),
  speechToVideoApi: vi.fn(),
  motionTransferApi: vi.fn(),
  videoUpscaleApi: vi.fn(),
  extendVideo: vi.fn(),
  faceSwapApi: vi.fn(),
  generateMask: vi.fn(),
  mergeVideoAudioApi: vi.fn(),
  trimAudioApi: vi.fn(),
  splitMediaApi: vi.fn(),
  trimVideoApi: vi.fn(),
  extractFrameApi: vi.fn(),
  transcodeVideoApi: vi.fn(),
  speedRampApi: vi.fn(),
  loopVideoApi: vi.fn(),
  fadeVideoApi: vi.fn(),
  resizeVideoApi: vi.fn(),
  socialMediaFormatApi: vi.fn(),
  adjustVolumeApi: vi.fn(),
  addCaptionsApi: vi.fn(),
  mixAudioApi: vi.fn(),
  combineAudioApi: vi.fn(),
  llmChatStream: vi.fn(),
  qaCheckApi: vi.fn(),
  webScrape: vi.fn(),
  setForcePrivate: vi.fn(),
  setUserPromptTemplate: vi.fn(),
}))

vi.mock("@/lib/prompt-templates", () => ({
  resolveTemplate: () => "{{userPrompt}}",
  applyTemplate: (t: string) => t,
}))

vi.mock("@/lib/generate-text-templates", () => ({
  getGenerateTextTemplate: () => null,
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: () => "scene prompt",
}))

vi.mock("../node-input-resolver", () => ({
  resolveNodeInputs: (...args: unknown[]) => mockResolveNodeInputs(...args),
  resolveSeedPromptHint: vi.fn(() => ""),
  resolveSourceThroughConnectedList: vi.fn((e: unknown) => e),
  extractNodeOutputAsList: vi.fn(() => undefined),
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: (...args: unknown[]) => mockExtractNodeOutput(...args),
  detectPreviewItemType: vi.fn(),
  collectMediaAssets: vi.fn(),
  buildAutoComposition: vi.fn(),
  collectAncestorRefs: vi.fn(() => []),
  IMAGE_SOURCE_TYPES: new Set<string>(),
  VIDEO_SOURCE_TYPES_FOR_RENDER: new Set<string>(),
  AUDIO_SOURCE_TYPES: new Set<string>(),
}))

vi.mock("../poll-job", () => ({
  pollJobWithNodeUpdate: vi.fn(),
  setSuppressToasts: () => {},
  guardedToast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock("../node-executors", () => ({
  runImageGeneration: vi.fn(),
  runEditImage: vi.fn(),
  runImageToImage: vi.fn(),
  runModifyImage: vi.fn(),
  runUpscaleImage: vi.fn(),
  runRemoveBackground: vi.fn(),
  runVideoGeneration: vi.fn(),
  runVideoToVideoGeneration: vi.fn(),
  runTextToVideoGeneration: vi.fn(),
  runTextToSpeechGeneration: vi.fn(),
  runScriptGeneration: vi.fn(),
  runCombineVideos: vi.fn(),
}))

vi.mock("../asset-executors", () => ({
  runCharacterGeneration: vi.fn(),
  runFaceGeneration: vi.fn(),
  runObjectGeneration: vi.fn(),
  runLocationGeneration: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = []
  mockEdges = []
})

describe("executeNode: reduce", () => {
  it("calls executeReduce with strategyId + resolved inputs[] and persists result on success", async () => {
    mockResolveNodeInputs.mockReturnValue({ inputs: ["a", "b"] })
    mockExecuteReduce.mockResolvedValue({
      jobId: "j1",
      output: "a-b",
      meta: { summary: "joined 2" },
    })

    const node = {
      id: "C1",
      type: "reduce",
      position: { x: 0, y: 0 },
      data: {
        label: "reduce",
        strategyId: "concat",
        strategyConfig: { separator: "-" },
      },
    } as any

    const out = await executeNode(node, makeCtx())

    expect(mockExecuteReduce).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyId: "concat",
        strategyConfig: { separator: "-" },
        inputs: ["a", "b"],
      }),
    )
    expect(out).toBe("a-b")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "C1",
      expect.objectContaining({ executionStatus: "running", __upstreamCount: 2 }),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "C1",
      expect.objectContaining({
        executionStatus: "completed",
        errorMessage: undefined,
        result: "a-b",
        currentJobId: "j1",
        lastInputs: ["a", "b"],
        lastMeta: { summary: "joined 2" },
      }),
    )
  })

  it("persists lastInputs and lastMeta with selectedIndex/reasoning for pick-best-llm", async () => {
    mockResolveNodeInputs.mockReturnValue({ inputs: ["x", "y", "z"] })
    mockExecuteReduce.mockResolvedValue({
      jobId: "j10",
      output: "y",
      meta: { summary: "picked 1 of 3", selectedIndex: 1, reasoning: "y wins" },
    })

    const node = {
      id: "C10",
      type: "reduce",
      position: { x: 0, y: 0 },
      data: {
        label: "reduce",
        strategyId: "pick-best-llm",
        strategyConfig: { criteria: "best", inputKind: "text" },
      },
    } as any

    await executeNode(node, makeCtx())

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "C10",
      expect.objectContaining({
        lastInputs: ["x", "y", "z"],
        lastMeta: { summary: "picked 1 of 3", selectedIndex: 1, reasoning: "y wins" },
      }),
    )
  })

  it("truncates persisted lastInputs to 50 items and caps each string at 500 chars", async () => {
    const big = Array.from({ length: 100 }, (_, i) =>
      i === 0 ? "x".repeat(900) : `item-${i}`,
    )
    mockResolveNodeInputs.mockReturnValue({ inputs: big })
    mockExecuteReduce.mockResolvedValue({
      jobId: "j11",
      output: "ok",
      meta: { summary: "ok" },
    })

    const node = {
      id: "C11",
      type: "reduce",
      position: { x: 0, y: 0 },
      data: { label: "reduce", strategyId: "concat", strategyConfig: {} },
    } as any

    await executeNode(node, makeCtx())

    const persistCall = mockUpdateNodeData.mock.calls.find(
      ([, payload]) => (payload as Record<string, unknown>).lastInputs !== undefined,
    )
    expect(persistCall).toBeTruthy()
    const persisted = (persistCall![1] as { lastInputs: string[] }).lastInputs
    expect(persisted.length).toBe(50)
    // First item was 900 chars — should be truncated to 500 chars + ellipsis (501)
    expect(persisted[0].length).toBe(501)
    expect(persisted[0].endsWith("…")).toBe(true)
  })

  it("clears selectedIndex on persisted meta when index falls outside the 50-item truncation window", async () => {
    const big = Array.from({ length: 100 }, (_, i) => `item-${i}`)
    mockResolveNodeInputs.mockReturnValue({ inputs: big })
    mockExecuteReduce.mockResolvedValue({
      jobId: "j12",
      output: "item-75",
      // The LLM picked index 75 — past the persisted-window upper bound of 49.
      meta: { summary: "picked", selectedIndex: 75, reasoning: "best" },
    })

    const node = {
      id: "C12",
      type: "reduce",
      position: { x: 0, y: 0 },
      data: { label: "reduce", strategyId: "pick-best-llm", strategyConfig: { criteria: "x" } },
    } as any

    await executeNode(node, makeCtx())

    const persistCall = mockUpdateNodeData.mock.calls.find(
      ([, payload]) => (payload as Record<string, unknown>).lastMeta !== undefined,
    )
    expect(persistCall).toBeTruthy()
    const persistedMeta = (persistCall![1] as { lastMeta: Record<string, unknown> }).lastMeta
    expect(persistedMeta.selectedIndex).toBeUndefined()
    expect(persistedMeta.reasoning).toBe("best")
    expect(persistedMeta.summary).toBe("picked")
  })

  it("falls back to empty inputs array when resolver returns nothing", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockExecuteReduce.mockResolvedValue({
      jobId: "j2",
      output: "",
      meta: { summary: "empty" },
    })

    const node = {
      id: "C2",
      type: "reduce",
      position: { x: 0, y: 0 },
      data: {
        label: "reduce",
        strategyId: "first-non-empty",
        strategyConfig: {},
      },
    } as any

    await executeNode(node, makeCtx())

    expect(mockExecuteReduce).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyId: "first-non-empty",
        inputs: [],
      }),
    )
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "C2",
      expect.objectContaining({ __upstreamCount: 0 }),
    )
  })

  it("marks failed on executeReduce rejection and rethrows", async () => {
    mockResolveNodeInputs.mockReturnValue({ inputs: ["x"] })
    mockExecuteReduce.mockRejectedValue(new Error("strategy boom"))

    const node = {
      id: "C3",
      type: "reduce",
      position: { x: 0, y: 0 },
      data: {
        label: "reduce",
        strategyId: "concat",
        strategyConfig: {},
      },
    } as any

    await expect(executeNode(node, makeCtx())).rejects.toThrow("strategy boom")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "C3",
      expect.objectContaining({
        executionStatus: "failed",
        errorMessage: "strategy boom",
      }),
    )
  })
})
