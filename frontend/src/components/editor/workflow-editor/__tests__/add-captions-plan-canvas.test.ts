/**
 * Add Captions with a wired caption plan on the CANVAS engine (spec §6.2): the
 * same styling composition as the DAG, one request of timed segments, nothing
 * else on it. Mocks mirror execute-node-processing.test.ts.
 */
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
import { styleCaptionPlan } from "@nodaro/shared"
import { BODY_CAPTIONS_PRESET_ID, CAPTION_SEGMENT_LEVER_KEYS, getFactoryPresets, hookPlateCaptionSegments } from "@nodaro/prompts"

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

const preset = (id: string) => getFactoryPresets("add-captions").find((p) => p.id === id)!.data as Record<string, unknown>
const bodyCaptions = preset(BODY_CAPTIONS_PRESET_ID)
const words = [{ text: "one", startMs: 1500, endMs: 1800 }, { text: "two", startMs: 1800, endMs: 2100 }]
const BOTH = { v: 1, hookText: "Sample hook", hookEndMs: 1400, bodyEndMs: 2400, captions: words }
const NOTHING_TIMED = { v: 1, hookText: "", hookEndMs: 0, bodyEndMs: 0, captions: [] }
const VIDEO = "https://cdn.example/v.mp4"

// The block hands its API call to the (mocked) poller; running it is what sends the request.
const sendRequest = async () => {
  const apiCall = mockPollJobWithNodeUpdate.mock.calls[0]![1] as () => Promise<unknown>
  await apiCall()
}

describe("add-captions with a wired caption plan (canvas)", () => {
  it("sends only the segments the DAG engine builds for the same plan — no lever, no text", async () => {
    const data = { ...bodyCaptions, backgroundColor: "#FF0000" }
    mockResolveNodeInputs.mockReturnValue({ videoUrl: VIDEO, captionPlan: JSON.stringify(BOTH) })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(makeNode("add-captions", data), makeCtx())
    await sendRequest()

    const expected = styleCaptionPlan(BOTH, { label: "add-captions", ...data }, { segmentsFor: hookPlateCaptionSegments, leverKeys: CAPTION_SEGMENT_LEVER_KEYS })
    expect("segments" in expected && expected.segments.length).toBeGreaterThan(0)
    expect(mockAddCaptionsApi).toHaveBeenCalledTimes(1)
    const [videoUrl, text, style, position, fontSize, color, backgroundColor, userId, opts] = mockAddCaptionsApi.mock.calls[0]!
    expect(videoUrl).toBe(VIDEO)
    expect(text).toBe("")
    expect([style, position, fontSize, color, backgroundColor]).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect(userId).toBe("u1")
    expect(opts).toEqual({ segments: (expected as { segments: unknown[] }).segments })
  })

  it("a plan that styles to nothing completes as a pass-through: no API call, passThroughWarning no_captions", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: VIDEO, captionPlan: JSON.stringify(NOTHING_TIMED) })

    await executeNode(makeNode("add-captions", { ...bodyCaptions }), makeCtx())

    expect(mockAddCaptionsApi).not.toHaveBeenCalled()
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ generatedVideoUrl: VIDEO, passThroughWarning: "no_captions", executionStatus: "completed" }),
    )
  })

  it("an invalid plan rejects with the parser's message and calls nothing", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: VIDEO, captionPlan: JSON.stringify({ ...BOTH, v: 3 }) })

    const promise = executeNode(makeNode("add-captions", { ...bodyCaptions }), makeCtx())
    promise.catch(() => {})

    await expect(promise).rejects.toThrow("Caption plan: v must be 1.")
    expect(mockAddCaptionsApi).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalled()
  })

  it("with no plan wired the node is unchanged: the node's own levers go to the API", async () => {
    mockResolveNodeInputs.mockReturnValue({ videoUrl: VIDEO, prompt: "Hello" })
    mockAddCaptionsApi.mockResolvedValue({ jobId: "j1" })
    mockPollJobWithNodeUpdate.mockResolvedValue(undefined)

    await executeNode(makeNode("add-captions", { style: "outline" }), makeCtx())
    await sendRequest()

    expect(mockAddCaptionsApi.mock.calls[0]![1]).toBe("Hello")
    expect(mockAddCaptionsApi.mock.calls[0]![2]).toBe("outline")
  })
})
