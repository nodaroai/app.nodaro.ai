/**
 * In-browser Extract Field, List output: one entry per JSON object, "" where the
 * object has no value — so two Extract Field lists cut from the same array stay
 * row-aligned in a fan-out. Twin of the backend `executeExtractField` cases in
 * `fanout-pairing.test.ts`; the text / JSON outputs must not change.
 *
 * (Mock harness copied from execute-node-reduce.test.ts.)
 */
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
  setCurrentNodeId: vi.fn(),
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
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/edit-plan-review.json"

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

const CONCEPTS = [
  { prompt: "PROMPT-1", negative: "NEG-1" },
  { prompt: "PROMPT-2", negative: "" },
  { prompt: "PROMPT-3", negative: "NEG-3" },
  { prompt: "PROMPT-4" },
  { prompt: "PROMPT-5", negative: null },
]

function run(data: Record<string, unknown>) {
  const llm = { id: "llm", type: "llm-chat", position: { x: 0, y: 0 }, data: { label: "LLM" } }
  const node = { id: "ex", type: "extract-field", position: { x: 0, y: 0 }, data: { label: "negative", mode: "custom", ...data } }
  mockNodes = [llm, node]
  mockEdges = [{ id: "e1", source: "llm", sourceHandle: "items", target: "ex", targetHandle: "in" }]
  mockResolveNodeInputs.mockReturnValue({})
  mockExtractNodeOutput.mockReturnValue(JSON.stringify(CONCEPTS))
  return executeNode(node as any, makeCtx())
}

const lastPatch = () => mockUpdateNodeData.mock.calls.filter((c) => c[0] === "ex").at(-1)?.[1] as Record<string, unknown>

describe("executeNode: extract-field (List output is row-aligned)", () => {
  it("publishes a row-aligned twin — one entry per object, empty where the object has no value", async () => {
    await run({ field: "negative", outputType: "list" })
    expect(lastPatch().__alignedListResults).toEqual(["NEG-1", "", "NEG-3", "", ""])
  })

  it("leaves the PUBLIC list exactly as it was — it is what item:N / range / Bundle and the list nodes index", async () => {
    await run({ field: "negative", outputType: "list" })
    // a missing / null value is skipped, an empty string is kept — as always
    expect(lastPatch().__listResults).toEqual(["NEG-1", "", "NEG-3"])
  })

  it("a field every object carries: both lists are simply its values", async () => {
    await run({ field: "prompt", outputType: "list" })
    const all = ["PROMPT-1", "PROMPT-2", "PROMPT-3", "PROMPT-4", "PROMPT-5"]
    expect(lastPatch().__listResults).toEqual(all)
    expect(lastPatch().__alignedListResults).toEqual(all)
  })

  it("the TEXT output is unchanged: the values that exist, one per line", async () => {
    const out = await run({ field: "negative", outputType: "text" })
    expect(out).toBe("NEG-1\n\nNEG-3")
    expect(lastPatch().__listResults).toBeUndefined()
    expect(lastPatch().__alignedListResults).toBeUndefined()
  })

  it("a field NO object carries is still an empty list, not a list of blanks", async () => {
    await run({ field: "missing", outputType: "list" })
    expect(lastPatch().__listResults).toEqual([])
    expect(lastPatch().__alignedListResults).toBeUndefined()
  })
})

describe("executeNode: a fan-out iteration resolves its inputs on its ROW", () => {
  it("reads the row from its own argument, not from the iteration number", async () => {
    const node = { id: "ex", type: "extract-field", position: { x: 0, y: 0 }, data: { label: "x", field: "" } }
    mockNodes = [node]
    mockResolveNodeInputs.mockReturnValue({})
    // Iteration #5 of a Repeat x2 fan-out sits on row 2.
    await executeNode(node as any, makeCtx(), undefined, undefined, 5, undefined, undefined, 2)
    expect(mockResolveNodeInputs).toHaveBeenCalledWith(node, mockNodes, mockEdges, 2)
  })

  it("a row left on the context by mistake is ignored — the context is not a channel for it", async () => {
    const node = { id: "ex", type: "extract-field", position: { x: 0, y: 0 }, data: { label: "x", field: "" } }
    mockNodes = [node]
    mockResolveNodeInputs.mockReturnValue({})
    await executeNode(node as any, makeCtx({ listRowIndex: 2 }), undefined, undefined, 5)
    expect(mockResolveNodeInputs).toHaveBeenCalledWith(node, mockNodes, mockEdges, 5)
  })

  it("outside a list-driven fan-out the iteration number stands (repeat-only / provider-only runs)", async () => {
    const node = { id: "ex", type: "extract-field", position: { x: 0, y: 0 }, data: { label: "x", field: "" } }
    mockNodes = [node]
    mockResolveNodeInputs.mockReturnValue({})
    await executeNode(node as any, makeCtx(), undefined, undefined, 5)
    expect(mockResolveNodeInputs).toHaveBeenCalledWith(node, mockNodes, mockEdges, 5)
  })
})

describe("executeNode: a JSON consumer of a reviewed Edit Plan reads what the server reads", () => {
  // The twoKept plan (kept: clips 1 and 4, clip 4's hook rewritten). The server
  // half of this check is backend edit-plan-review-engines.test.ts, on the same
  // fixture block.
  const { consumers } = fixture
  const plan = { ...(fixture.cases as Record<string, { plan: { id: string } }>)[consumers.case]!.plan, position: { x: 0, y: 0 } }
  const runConsumer = (type: string, data: Record<string, unknown>) => {
    const node = { id: "consumer", type, position: { x: 0, y: 0 }, data: { label: type, ...data } }
    mockNodes = [plan, node]
    mockEdges = [{ id: "e-in", source: plan.id, sourceHandle: "edl", target: node.id, targetHandle: "in" }]
    mockResolveNodeInputs.mockReturnValue({})
    return executeNode(node as any, makeCtx())
  }
  const patchOf = () => mockUpdateNodeData.mock.calls.filter((c) => c[0] === "consumer").at(-1)?.[1] as Record<string, unknown>

  it("Extract Field: the kept clips' hooks, the edited one included", async () => {
    const out = await runConsumer("extract-field", { field: consumers.extractField.field, outputType: "text" })
    expect(out).toBe(consumers.extractField.text)
    expect(patchOf().extractedText).toBe(consumers.extractField.text)
  })

  it("JSON Process: the kept clips, the edited hook included", async () => {
    await runConsumer("json-process", { mode: "advanced", expression: consumers.jsonProcess.expression })
    expect(patchOf().processedResult).toEqual(consumers.jsonProcess.processedResult)
  })
})
