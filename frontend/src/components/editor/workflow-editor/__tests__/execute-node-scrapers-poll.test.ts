import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock variables (declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockExecuteReduce = vi.fn()
const mockMetaAdsScrape = vi.fn()
const mockInstagramScrape = vi.fn()
const mockPollScrapeJobOutput = vi.fn()
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
  metaAdsScrape: (...args: unknown[]) => mockMetaAdsScrape(...args),
  instagramScrape: (...args: unknown[]) => mockInstagramScrape(...args),
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
  pollScrapeJobOutput: (...args: unknown[]) => mockPollScrapeJobOutput(...args),
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

/**
 * The other two scrapers run past the ~100 s edge timeout as well (a Meta Ads
 * run that copies every video and analyses every ad; an Instagram profile
 * scrape measured 176 s). Both ask for a job id and poll — and both record which
 * job their payload came from, so a later reload can tell the result is already
 * on the node instead of re-applying it and resetting the featured item.
 */
describe("executeNode: meta-ads-scrape", () => {
  const adsNode = {
    id: "node_7",
    type: "meta-ads-scrape",
    position: { x: 0, y: 0 },
    data: { label: "Meta Ads", mode: "search", query: "nike" },
  } as any
  const patches = () => mockUpdateNodeData.mock.calls.filter((c) => c[0] === "node_7").map((c) => c[1] as Record<string, unknown>)

  beforeEach(() => {
    mockResolveNodeInputs.mockReturnValue({})
  })

  it("asks for the job, polls it, and paints what the poll returns", async () => {
    const ads = [{ adArchiveId: "1", pageName: "Nike" }, { adArchiveId: "2", pageName: "Nike" }]
    mockMetaAdsScrape.mockResolvedValue({ jobId: "job-ads", status: "pending" })
    mockPollScrapeJobOutput.mockResolvedValue({ json: ads })
    const signal = new AbortController().signal

    const out = await executeNode(adsNode, makeCtx({ signal }))

    expect(mockMetaAdsScrape).toHaveBeenCalledWith(expect.objectContaining({ mode: "search", query: "nike" }))
    expect(mockPollScrapeJobOutput).toHaveBeenCalledWith("job-ads", "node_7", { signal })
    expect(patches().at(-1)).toMatchObject({
      executionStatus: "completed",
      lastRunOutcome: "success",
      lastRunCount: 2,
      generatedJson: ads,
      featuredIndex: 0,
      viewFormat: "all",
      lastAppliedJobId: "job-ads",
    })
    expect(out).toBe(JSON.stringify(ads))
  })

  it("a Stop is not a failure", async () => {
    const controller = new AbortController()
    mockMetaAdsScrape.mockResolvedValue({ jobId: "job-ads", status: "pending" })
    mockPollScrapeJobOutput.mockImplementation(async () => {
      controller.abort()
      throw new DOMException("Aborted", "AbortError")
    })

    await expect(executeNode(adsNode, makeCtx({ signal: controller.signal }))).resolves.toBe("")
    expect(patches().some((p) => p.lastRunOutcome === "failed")).toBe(false)
  })

  it("records a failed job as a failure and rethrows", async () => {
    mockMetaAdsScrape.mockResolvedValue({ jobId: "job-ads", status: "pending" })
    mockPollScrapeJobOutput.mockRejectedValue(new Error("Actor run timed out"))

    await expect(executeNode(adsNode, makeCtx())).rejects.toThrow("Actor run timed out")
    expect(patches().at(-1)).toMatchObject({ lastRunOutcome: "failed", errorMessage: "Actor run timed out" })
  })
})

describe("executeNode: instagram-scrape", () => {
  const igNode = {
    id: "node_8",
    type: "instagram-scrape",
    position: { x: 0, y: 0 },
    data: { label: "Instagram", mode: "profile", targets: "nasa" },
  } as any

  beforeEach(() => {
    mockResolveNodeInputs.mockReturnValue({})
  })

  it("records the job its payload came from", async () => {
    const posts = [{ ownerUsername: "nasa", caption: "Artemis" }]
    mockInstagramScrape.mockResolvedValue({ jobId: "job-ig", status: "pending" })
    mockPollScrapeJobOutput.mockResolvedValue({ json: posts })

    await executeNode(igNode, makeCtx())

    const last = mockUpdateNodeData.mock.calls.filter((c) => c[0] === "node_8").at(-1)?.[1]
    expect(last).toMatchObject({ lastRunOutcome: "success", generatedJson: posts, lastAppliedJobId: "job-ig" })
  })

  it("a run features its first post: the saved featured index is not sent", async () => {
    // The node resets to post 0 on completion; the saved index points into the
    // previous run's posts, so sending it featured (and copied) another post.
    mockInstagramScrape.mockResolvedValue({ jobId: "job-ig", status: "pending" })
    mockPollScrapeJobOutput.mockResolvedValue({ json: [] })

    await executeNode({ ...igNode, data: { ...igNode.data, featuredIndex: 3 } }, makeCtx())

    expect(mockInstagramScrape.mock.calls.at(-1)?.[0]).not.toHaveProperty("featuredIndex")
  })
})

describe("executeNode: meta-ads-scrape features its first ad", () => {
  it("the saved featured index is not sent", async () => {
    mockResolveNodeInputs.mockReturnValue({})
    mockMetaAdsScrape.mockResolvedValue({ jobId: "job-ads", status: "pending" })
    mockPollScrapeJobOutput.mockResolvedValue({ json: [] })
    const node = {
      id: "node_9",
      type: "meta-ads-scrape",
      position: { x: 0, y: 0 },
      data: { label: "Meta Ads", mode: "search", query: "nike", featuredIndex: 3 },
    } as any

    await executeNode(node, makeCtx())

    expect(mockMetaAdsScrape.mock.calls.at(-1)?.[0]).not.toHaveProperty("featuredIndex")
  })
})
