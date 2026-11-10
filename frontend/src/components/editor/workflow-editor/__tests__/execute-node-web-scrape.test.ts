import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock variables (declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockUpdateNodeData = vi.fn()
const mockExecuteReduce = vi.fn()
const mockWebScrape = vi.fn()
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
  webScrape: (...args: unknown[]) => mockWebScrape(...args),
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
  // The budget a background scrape is polled for (its own value: ./poll-job, @nodaro/render-rules).
  SCRAPE_POLL_BUDGET_MS: 46 * 60_000,
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
 * The editor used to hold the POST open until the scrape was done. A 20-page
 * site crawl measured 252 s against an edge timeout of ~100 s: the request died
 * with a 524 ("Web scrape failed"), the job finished server-side, the credits
 * were committed, and the node said "failed". It now asks for the job id and
 * polls, like every generation node.
 */
describe("executeNode: web-scrape", () => {
  const crawlNode = {
    id: "node_1",
    type: "web-scrape",
    position: { x: 0, y: 0 },
    data: { label: "Web Scrape", actor: "content-crawler", url: "https://owalalife.com/", mode: "site" },
  } as any

  const patches = () => mockUpdateNodeData.mock.calls.filter((c) => c[0] === "node_1").map((c) => c[1] as Record<string, unknown>)

  beforeEach(() => {
    mockResolveNodeInputs.mockReturnValue({})
  })

  it("asks for the job, polls it, and paints what the poll returns", async () => {
    const crawl = { pages: [{ url: "https://owalalife.com/" }, { url: "https://owalalife.com/collections/all" }] }
    mockWebScrape.mockResolvedValue({ jobId: "job-9", status: "pending" })
    mockPollScrapeJobOutput.mockResolvedValue({ json: crawl })
    const signal = new AbortController().signal

    const out = await executeNode(crawlNode, makeCtx({ signal }))

    expect(mockWebScrape).toHaveBeenCalledWith(expect.objectContaining({ actor: "content-crawler", url: "https://owalalife.com/", mode: "site" }))
    // Polled by job id, on the node, with the run's own Stop signal.
    expect(mockPollScrapeJobOutput).toHaveBeenCalledWith("job-9", "node_1", { signal, budgetMs: 46 * 60_000 })
    expect(patches().at(-1)).toMatchObject({
      executionStatus: "completed",
      lastRunOutcome: "success",
      lastRunCount: 2,
      generatedJson: crawl,
      // What lets a later reload know this job's result is already on the node.
      lastAppliedJobId: "job-9",
    })
    expect(out).toBe(JSON.stringify(crawl))
  })

  it("keeps the last good payload when the run comes back empty (#765)", async () => {
    mockWebScrape.mockResolvedValue({ jobId: "job-9", status: "pending" })
    mockPollScrapeJobOutput.mockResolvedValue({ json: { pages: [] } })

    await executeNode(crawlNode, makeCtx())

    const last = patches().at(-1)!
    expect(last).toMatchObject({ lastRunOutcome: "empty", lastAppliedJobId: "job-9" })
    expect("generatedJson" in last).toBe(false)
  })

  it("records a failed job as a failure and rethrows", async () => {
    mockWebScrape.mockResolvedValue({ jobId: "job-9", status: "pending" })
    mockPollScrapeJobOutput.mockRejectedValue(new Error("Actor run timed out"))

    await expect(executeNode(crawlNode, makeCtx())).rejects.toThrow("Actor run timed out")

    expect(patches().at(-1)).toMatchObject({ executionStatus: "failed", lastRunOutcome: "failed", errorMessage: "Actor run timed out" })
    expect(mockToastError).toHaveBeenCalledWith("Web Scrape failed: Actor run timed out")
  })

  it("a failed job's words go onto the node beside its sentence", async () => {
    mockWebScrape.mockResolvedValue({ jobId: "job-9", status: "pending" })
    mockPollScrapeJobOutput.mockRejectedValue(Object.assign(new Error("The page could not be read."), { errorDetail: "Request blocked: The uploaded image may contain protected or restricted IP content." }))

    await expect(executeNode(crawlNode, makeCtx())).rejects.toThrow("The page could not be read.")
    expect(patches().at(-1)).toMatchObject({ executionStatus: "failed", errorMessage: "The page could not be read.", errorDetail: "Request blocked: The uploaded image may contain protected or restricted IP content." })
  })

  it("a Stop is not a failure — the aborted poll leaves the node to the Stop handler", async () => {
    const controller = new AbortController()
    mockWebScrape.mockResolvedValue({ jobId: "job-9", status: "pending" })
    mockPollScrapeJobOutput.mockImplementation(async () => {
      controller.abort()
      throw new DOMException("Aborted", "AbortError")
    })

    await expect(executeNode(crawlNode, makeCtx({ signal: controller.signal }))).resolves.toBe("")

    expect(patches().some((p) => p.lastRunOutcome === "failed")).toBe(false)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("a refusal before any job exists (credits, validation) is a failure with the server's words", async () => {
    mockWebScrape.mockRejectedValue(new Error("Insufficient credits"))

    await expect(executeNode(crawlNode, makeCtx())).rejects.toThrow("Insufficient credits")

    expect(mockPollScrapeJobOutput).not.toHaveBeenCalled()
    expect(patches().at(-1)).toMatchObject({ lastRunOutcome: "failed", errorMessage: "Insufficient credits" })
  })
})
