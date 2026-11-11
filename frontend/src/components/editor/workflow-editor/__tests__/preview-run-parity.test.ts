/**
 * Preview↔Run PARITY GUARD (code-review finding on fix/prompt-preview-single-source).
 *
 * `assembleVideoPrompt` (`@/lib/video-prompt-assembly`) and `assembleAudioPrompt`
 * (`@/lib/audio-prompt-assembly`) MIRROR the inline prompt composition inside the
 * `execute-node.ts` run handlers, so the final-prompt PREVIEW shows the exact text
 * the run sends. Nothing structurally PINS the two together — a future edit to
 * `execute-node`'s composition would silently drift the preview.
 *
 * Repo rule (CLAUDE.md): prefer "an invariant + guard test over 'remember to
 * update the list'." These tests close that gap: each case runs the REAL run
 * handler via `executeNode`, captures the prompt string the mocked run API
 * received, and asserts it `===` the shared assembler's output for the same
 * `{ node, nodes, edges, refMap }`. Any future divergence between the run's
 * inline composition and the assembler fails HERE.
 *
 * Scope (per the finding): graphs where the prompt comes from `node.data` (NOT a
 * wired upstream prompt) — that is the preview's documented assumption (the
 * assembler resolves the typed prompt with `{ refMap }` only, no `wired`/
 * `override`). So `mockResolveNodeInputs` NEVER returns `.prompt`.
 *
 * The mock setup mirrors `execute-node.test.ts` (that file exports no fixtures).
 * The ONE deviation: `mockPollJobWithNodeUpdate` is made to invoke the apiCall
 * factory, because the audio handlers (generate-music / voice-design) route their
 * final prompt through `runProcessingNode → pollJobWithNodeUpdate(apiCall)` rather
 * than a directly-mocked executor. Invoking the factory lets the mocked
 * `generateMusicApi` / `voiceDesignApi` record the args the run actually built.
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
const mockVoiceRemixApi = vi.fn()
const mockVoiceDesignApi = vi.fn()
let mockNodes: any[] = []
let mockEdges: any[] = []
let mockCharacterDefinitions: any[] = []

// ---------------------------------------------------------------------------
// Mocks (mirrors execute-node.test.ts — kept minimal but structurally identical)
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

// `generateMusicApi` is a BARE vi.fn() here (NOT a wrapper) so the test can
// `import { generateMusicApi }` and assert on its `.mock.calls` directly — the
// generate-music handler builds the final prompt as its FIRST positional arg.
vi.mock("@/lib/api", () => ({
  generateImage: vi.fn(),
  getJobStatusLean: vi.fn(),
  generateMusicApi: vi.fn(() => Promise.resolve({ jobId: "music-job" })),
  // BARE vi.fn() (like generateMusicApi) so the suno parity case can
  // `import { sunoGenerateApi }` and assert on `.mock.calls[0][0]` — the
  // assembled AssembleSunoResult object the run sends.
  sunoGenerateApi: vi.fn(() => Promise.resolve({ jobId: "suno-job" })),
  voiceDesignApi: (...args: unknown[]) => mockVoiceDesignApi(...args),
  voiceRemixApi: (...args: unknown[]) => mockVoiceRemixApi(...args),
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

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: () => "scene prompt",
}))

vi.mock("../node-input-resolver", () => ({
  resolveNodeInputs: (...args: unknown[]) => mockResolveNodeInputs(...args),
  resolveSeedPromptHint: vi.fn(() => ""),
  resolveCharacterAssets: vi.fn(() => ({ injectedAssets: "", facetInjections: [] })),
  // Character-borne elements ride `ConnectedReference.elementInjection`
  // (stampElementInjections), consumed by BOTH the preview (build-image-assemble-
  // input) and the run (execute-node). These fixtures wire no elements, so a
  // pass-through is behaviorally identical to the real stamp AND keeps preview
  // and run byte-identical — the property this suite guards.
  stampElementInjections: vi.fn((refs: unknown) => refs),
  collectCharacterElementInjections: vi.fn(() => new Map<string, string>()),
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: (...args: unknown[]) => mockExtractNodeOutput(...args),
  detectPreviewItemType: (...args: unknown[]) => mockDetectPreviewItemType(...args),
  collectMediaAssets: (...args: unknown[]) => mockCollectMediaAssets(...args),
  buildAutoComposition: (...args: unknown[]) => mockBuildAutoComposition(...args),
  collectAncestorRefs: (...args: unknown[]) => mockCollectAncestorRefs(...args),
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
  // The audio handlers route their final prompt through
  // runProcessingNode → pollJobWithNodeUpdate(nodeId, apiCall, …). Invoke the
  // factory so the mocked generateMusicApi / voiceDesignApi record the prompt
  // the run built. (execute-node.test.ts's stub is inert; this test NEEDS the
  // call to fire to capture the arg.)
  pollJobWithNodeUpdate: (...args: unknown[]) => mockPollJobWithNodeUpdate(...args),
  setSuppressToasts: () => {},
  guardedToast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock("../node-executors", () => ({
  runImageGeneration: (...args: unknown[]) => mockRunImageGeneration(...args),
  runEditImage: (...args: unknown[]) => mockRunEditImage(...args),
  runImageToImage: (...args: unknown[]) => mockRunImageToImage(...args),
  runVideoGeneration: (...args: unknown[]) => mockRunVideoGeneration(...args),
  runVideoToVideoGeneration: (...args: unknown[]) => mockRunVideoToVideoGeneration(...args),
  runTextToVideoGeneration: (...args: unknown[]) => mockRunTextToVideoGeneration(...args),
  runTextToSpeechGeneration: (...args: unknown[]) => mockRunTextToSpeechGeneration(...args),
  runScriptGeneration: (...args: unknown[]) => mockRunScriptGeneration(...args),
  runCombineVideos: (...args: unknown[]) => mockRunCombineVideos(...args),
}))

vi.mock("../asset-executors", () => ({
  runCharacterGeneration: (...args: unknown[]) => mockRunCharacterGeneration(...args),
  runFaceGeneration: (...args: unknown[]) => mockRunFaceGeneration(...args),
  runObjectGeneration: (...args: unknown[]) => mockRunObjectGeneration(...args),
  runLocationGeneration: (...args: unknown[]) => mockRunLocationGeneration(...args),
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
import { generateMusicApi, sunoGenerateApi } from "@/lib/api"
import { assembleVideoPrompt } from "@/lib/video-prompt-assembly"
import { assembleAudioPrompt, assembleSunoPreview } from "@/lib/audio-prompt-assembly"
import {
  getCameraMotionPromptHint,
  getCameraMotionTerm,
  getStylePromptHint,
  getStyleVideoPromptHint,
} from "@nodaro/prompts/pickers"
import {
  renderStructuredFields,
} from "@nodaro/prompts/prompt-builder"
import { buildNodeRefMap } from "@/lib/node-refs"

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

/** Consumer node id is fixed to "n1" so edges + refMap line up with the graph. */
function makeNode(type: string, data: any = {}) {
  return {
    id: "n1",
    type,
    position: { x: 0, y: 0 },
    data: { label: type, ...data },
  } as any
}

/**
 * The assembler signature the preview hook uses: it always passes the consumer
 * node + the SAME nodes/edges the run reads + `buildNodeRefMap(id, nodes, edges)`
 * (identical to execute-node.ts:845). Building it here from the test graph
 * guarantees both sides see the same ref map.
 */
function assemblerArgs(node: any) {
  return {
    node,
    nodes: mockNodes,
    edges: mockEdges,
    refMap: buildNodeRefMap(node.id, mockNodes, mockEdges),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = []
  mockEdges = []
  mockCharacterDefinitions = []
  mockDetectPreviewItemType.mockImplementation(() => "text")
  // Default: no wired inputs at all → typed prompt is read from data only, so
  // promptOf({ wired: undefined }) === computeNodePrompt({ refMap }) (the
  // assembler's path). Per-test overrides add ONLY non-prompt inputs.
  mockResolveNodeInputs.mockReturnValue({})
  mockCollectAncestorRefs.mockReturnValue([])
  // Re-arm the audio fold: pollJobWithNodeUpdate runs the apiCall factory the
  // handler passes (arg index 1) so the mocked API captures the final prompt.
  mockPollJobWithNodeUpdate.mockImplementation(
    async (_nodeId: string, apiCall: () => Promise<unknown>) => {
      await apiCall()
      return ""
    },
  )
})

// ===========================================================================
// VIDEO parity
// ===========================================================================

describe("preview↔run parity — video", () => {
  it("(a) image-to-video: run prompt === assembleVideoPrompt('image-to-video') — typed prompt + motion + connected cinematography Person node", async () => {
    // Consumer: image-to-video with a typed prompt + enabled motion.
    // Upstream: a `person` cinematography node on the `look` handle (a real
    // cinematography source `collectCinematographyHints` folds in). `preText`
    // forces a non-empty hint without depending on catalog ids (drift-proof —
    // both run + assembler read the same node, so the exact hint is irrelevant
    // to the equality; it only needs to EXERCISE the fold).
    const personNode = {
      id: "cine-person",
      type: "person",
      position: { x: 0, y: 0 },
      data: {
        label: "Person",
        preText: "a weathered fisherman",
        age: "elderly",
      },
    }
    const i2vNode = makeNode("image-to-video", {
      prompt: "walking along the pier at dawn",
      motion: "slow zoom",
      motionEnabled: true,
    })
    mockNodes = [personNode, i2vNode]
    // `look` is one of the cinematography handles collectCinematographyHints accepts.
    mockEdges = [
      { id: "e1", source: "cine-person", target: "n1", targetHandle: "look" },
    ]
    // Start frame supplied via inputs.imageUrl (NOT a prompt) so the node runs.
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://frame.png" })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(i2vNode as any, makeCtx())

    // runVideoGeneration(node.id, startFrame, ctx, endFrame, audio, provider,
    //   generateAudio, duration, prompt@8, …) — prompt is positional arg 8.
    expect(mockRunVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunVideoGeneration.mock.calls[0][8] as string

    const previewPrompt = assembleVideoPrompt("image-to-video", assemblerArgs(i2vNode))

    // Sanity: the fold actually fired (motion + cinematography present), so this
    // is a meaningful parity assertion, not "" === "".
    expect(runPrompt).toContain("walking along the pier at dawn")
    expect(runPrompt).toContain("slow zoom motion")
    expect(runPrompt).toContain("a weathered fisherman")
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(b) text-to-video: run prompt === assembleVideoPrompt('text-to-video') — typed prompt + connected Character (@-mention)", async () => {
    // Consumer: text-to-video with a typed prompt @-mentioning a wired Character.
    // `resolveVideoPromptMentions` (shared by run + assembler) resolves the
    // mention + attaches the variant; the resolved prompt text is what we pin.
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
    const t2vNode = makeNode("text-to-video", {
      prompt: "@kira:1:smile dancing in a neon alley",
    })
    mockNodes = [kiraNode, t2vNode]
    mockEdges = [{ id: "e1", source: "char-kira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({}) // no wired prompt
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode as any, makeCtx())

    // runTextToVideoGeneration(node.id, prompt@1, ctx, provider, options, idem).
    expect(mockRunTextToVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string

    const previewPrompt = assembleVideoPrompt("text-to-video", assemblerArgs(t2vNode))

    // Sanity: mention was resolved (literal token gone, directive emitted).
    expect(runPrompt).not.toMatch(/@kira:1:smile\b/)
    expect(runPrompt).toContain("Image 1 (kira)")
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(b2) text-to-video: parity for a plainly-wired Character WITHOUT @-mention (canonical fallback)", async () => {
    // Variant: no @-mention → the wired Character contributes a canonical
    // fallback directive block. Both run + assembler build it via the shared
    // resolveVideoPromptMentions, so they must still match byte-for-byte.
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
    const t2vNode = makeNode("text-to-video", {
      prompt: "running through a rainstorm",
    })
    mockNodes = [kiraNode, t2vNode]
    mockEdges = [{ id: "e1", source: "char-kira", target: "n1" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode as any, makeCtx())

    const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    const previewPrompt = assembleVideoPrompt("text-to-video", assemblerArgs(t2vNode))

    expect(runPrompt).toContain("Use these characters:")
    expect(runPrompt).toContain("The subject must remain exactly the same person")
    expect(previewPrompt).toBe(runPrompt)
  })

  // ── Task 3.3: the RUN path resolves {image:N} → @image_N for ref-capable
  // providers, exactly as the PREVIEW (assembleVideoPrompt) does (Task 3.2). ──
  /** A plain upstream image source wired to the consumer's `references` handle. */
  function refImageNode() {
    return {
      id: "ref-img",
      type: "upload-image",
      position: { x: 0, y: 0 },
      data: { label: "Upload" },
    }
  }

  it("(e) image-to-video ref-capable: run resolves {image:1} into an @image_1 binding (parity)", async () => {
    // seedance-2 declares the `reference-image` capability → the {image:N} token
    // is KEPT and resolved (not stripped). The run must produce the same text the
    // preview does. Start frame supplied so the dispatch fires regardless of the
    // provider's ref-only handling.
    const i2vNode = makeNode("image-to-video", {
      prompt: "circle {image:1:object}",
      provider: "seedance-2",
    })
    mockNodes = [refImageNode(), i2vNode]
    // ONE `references`-handle edge → imageRefCount = 1 → {image:1} binds @image_1.
    mockEdges = [
      { id: "e1", source: "ref-img", target: "n1", targetHandle: "references" },
    ]
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://frame.png" })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(i2vNode as any, makeCtx())

    expect(mockRunVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunVideoGeneration.mock.calls[0][8] as string
    const previewPrompt = assembleVideoPrompt("image-to-video", assemblerArgs(i2vNode))

    // Token RESOLVED (not stripped to the bare label): the @image_1 binding lands.
    expect(runPrompt).toContain("circle the object from @image_1")
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(f) image-to-video NON-ref provider: run strips {image:1} to the bare label (regression guard + parity)", async () => {
    // minimax has no `reference-image` capability → legacy strip path. Run +
    // preview both emit the bare label, no @image_N binding.
    const i2vNode = makeNode("image-to-video", {
      prompt: "circle {image:1:object}",
      provider: "minimax",
    })
    mockNodes = [refImageNode(), i2vNode]
    mockEdges = [
      { id: "e1", source: "ref-img", target: "n1", targetHandle: "references" },
    ]
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://frame.png" })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(i2vNode as any, makeCtx())

    const runPrompt = mockRunVideoGeneration.mock.calls[0][8] as string
    const previewPrompt = assembleVideoPrompt("image-to-video", assemblerArgs(i2vNode))

    expect(runPrompt).toBe("circle object")
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(g) text-to-video ref-capable: run resolves {image:1} into an @image_1 binding (second path, parity)", async () => {
    // Same gate on the t2v run path. seedance-2 keeps + resolves the token.
    const t2vNode = makeNode("text-to-video", {
      prompt: "circle {image:1:object}",
      provider: "seedance-2",
    })
    mockNodes = [refImageNode(), t2vNode]
    mockEdges = [
      { id: "e1", source: "ref-img", target: "n1", targetHandle: "references" },
    ]
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode as any, makeCtx())

    expect(mockRunTextToVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    const previewPrompt = assembleVideoPrompt("text-to-video", assemblerArgs(t2vNode))

    expect(runPrompt).toContain("circle the object from @image_1")
    expect(previewPrompt).toBe(runPrompt)
  })

  // ── Unified `generate-video` node: the RUN re-types it to i2v/t2v before
  // composing (execute-node.ts ~1814); the PREVIEW must resolve the SAME effective
  // mode (resolveGenerateVideoMode) or its {image:N} tokens ride through raw. These
  // two cases pin both modes — the gap that shipped {image:2:object} unresolved in
  // the final-prompt preview while the run sent `@image_2`. ──

  it("(h) generate-video, no frame → t2v: run resolves {image:1} → @image_1, preview matches (parity)", async () => {
    // The user's bug scenario: reference image wired (no start frame), seedance-2.
    // hasImage=false → run picks text-to-video → {image:1:object} → @image_1.
    const genVidNode = makeNode("generate-video", {
      prompt: "circle {image:1:object}",
      provider: "seedance-2",
    })
    mockNodes = [refImageNode(), genVidNode]
    // Reference image on the canonical generate-video handle → imageRefCount=1.
    mockEdges = [
      { id: "e1", source: "ref-img", target: "n1", targetHandle: "imageReferences" },
    ]
    // No start/end frame resolved → hasImage=false → run dispatches to text-to-video.
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(genVidNode as any, makeCtx())

    expect(mockRunTextToVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    // Preview is called with the REAL node type "generate-video" (as the hook does).
    const previewPrompt = assembleVideoPrompt("generate-video", assemblerArgs(genVidNode))

    // Token RESOLVED, not stripped or left raw — the @image_1 binding lands.
    expect(runPrompt).toContain("circle the object from @image_1")
    expect(runPrompt).not.toMatch(/\{image:1/)
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(h2) generate-video, no frame → t2v: the node's own Motion still lands, in run AND preview", async () => {
    // The Motion control shows with or without a start frame, and the
    // orchestrator's generate-video case applies it in both modes. The editor
    // used to drop it here (only the i2v branch folded it), so a workflow run and
    // an editor run of the same node sent different prompts.
    const genVidNode = makeNode("generate-video", {
      prompt: "a lighthouse in a storm",
      provider: "seedance-2",
      motion: "dynamic",
      motionEnabled: true,
    })
    mockNodes = [genVidNode]
    mockEdges = []
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(genVidNode as any, makeCtx())

    expect(mockRunTextToVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    const previewPrompt = assembleVideoPrompt("generate-video", assemblerArgs(genVidNode))

    expect(runPrompt).toContain("a lighthouse in a storm. dynamic motion")
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(h3) a legacy text-to-video node has no own Motion: nothing is folded in run or preview", async () => {
    const t2vNode = makeNode("text-to-video", {
      prompt: "a lighthouse in a storm",
      provider: "seedance-2",
      motion: "dynamic",
      motionEnabled: true,
    })
    mockNodes = [t2vNode]
    mockEdges = []
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode as any, makeCtx())

    const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    expect(runPrompt).not.toContain("motion")
    expect(assembleVideoPrompt("text-to-video", assemblerArgs(t2vNode))).toBe(runPrompt)
  })

  it("(i) generate-video, start frame → i2v: run folds motion + resolves {image:1}, preview matches (parity)", async () => {
    // A wired START frame flips the unified node to image-to-video — this case
    // guards the mode detection, not just token resolution (the node's own
    // Motion folds in both modes, see (h2)).
    const frameNode = { id: "frame-img", type: "upload-image", position: { x: 0, y: 0 }, data: { label: "Frame" } }
    const genVidNode = makeNode("generate-video", {
      prompt: "circle {image:1:object}",
      provider: "seedance-2",
      motion: "slow zoom",
      motionEnabled: true,
    })
    mockNodes = [refImageNode(), frameNode, genVidNode]
    mockEdges = [
      { id: "e1", source: "ref-img", target: "n1", targetHandle: "imageReferences" },
      { id: "e2", source: "frame-img", target: "n1", targetHandle: "startFrame" },
    ]
    // Start frame resolved → hasImage=true → run dispatches to image-to-video.
    mockResolveNodeInputs.mockReturnValue({ startFrameUrl: "http://frame.png" })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(genVidNode as any, makeCtx())

    expect(mockRunVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunVideoGeneration.mock.calls[0][8] as string
    const previewPrompt = assembleVideoPrompt("generate-video", assemblerArgs(genVidNode))

    // i2v mode: motion folded AND the reference token resolved.
    expect(runPrompt).toContain("circle the object from @image_1")
    expect(runPrompt).toContain("slow zoom motion")
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(i2) generate-video + gemini-omni-flash source clip → i2v in BOTH run and preview (family parity)", async () => {
    // The Gemini Omni FAMILY's V2V override is the one place a wired reference
    // VIDEO (not a frame) flips the unified node to image-to-video. It lives in
    // TWO places — execute-node's dispatch and video-prompt-assembly's
    // resolveGenerateVideoMode — and this case is what fails if only one of them
    // learns the family: the run would fold the motion hint while the preview
    // composed it as t2v (or vice versa).
    const srcClip = { id: "src-clip", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Clip" } }
    const genVidNode = makeNode("generate-video", {
      prompt: "circle {image:1:object}",
      provider: "gemini-omni-flash",
      motion: "slow zoom",
      motionEnabled: true,
    })
    mockNodes = [refImageNode(), srcClip, genVidNode]
    mockEdges = [
      { id: "e1", source: "ref-img", target: "n1", targetHandle: "imageReferences" },
      { id: "e2", source: "src-clip", target: "n1", targetHandle: "videoReferences" },
    ]
    // No frame — only the source clip + a reference image. Refs alone do NOT
    // flip the mode, so reaching i2v is proof the VIDEO ref did it.
    mockResolveNodeInputs.mockReturnValue({
      referenceVideoUrls: ["http://cdn.example/source.mp4"],
      referenceImageUrls: ["http://cdn.example/look.png"],
    })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(genVidNode as any, makeCtx())

    expect(mockRunTextToVideoGeneration).not.toHaveBeenCalled()
    expect(mockRunVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunVideoGeneration.mock.calls[0][8] as string
    const previewPrompt = assembleVideoPrompt("generate-video", assemblerArgs(genVidNode))

    expect(runPrompt).toContain("slow zoom motion")
    expect(previewPrompt).toBe(runPrompt)
  })

  // ── D5 unified-asset-references: an Assets-handle ENTITY (object/animal/
  // location) auto-attaches and is referenceable via {image:N}, identically in
  // preview and run. ──
  it("(j) text-to-video: an OBJECT on the Assets handle resolves to @image_1 in BOTH preview and run", async () => {
    const objNode = {
      id: "obj-1",
      type: "object",
      position: { x: 0, y: 0 },
      data: { label: "Gadget", objectName: "Gadget", sourceImageUrl: "http://r2/gadget.png" },
    }
    const t2vNode = makeNode("text-to-video", {
      prompt: "spinning {image:1:gadget}",
      provider: "seedance-2", // ref-capable
    })
    mockNodes = [objNode, t2vNode]
    // Wired via the Assets handle (NOT an image-ref handle) → not counted toward
    // ordinalOffset, but attaches as an entity extra → @image_1.
    mockEdges = [{ id: "e1", source: "obj-1", target: "n1", sourceHandle: "objectRef", targetHandle: "assets" }]
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode as any, makeCtx())

    expect(mockRunTextToVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    const previewPrompt = assembleVideoPrompt("text-to-video", assemblerArgs(t2vNode))

    // The object asset resolved into the @image_1 binding (not stripped/raw).
    expect(runPrompt).toContain("the gadget from @image_1")
    expect(runPrompt).not.toMatch(/\{image:1/)
    expect(previewPrompt).toBe(runPrompt)
  })

  // ── A Style node with a second look picker wired after it ── every style's
  // video wording ends a sentence, so the hint list must join the way the run
  // joins it (`appendPromptHints`): no comma after the style's closing period.
  const styleThenPerson = () => {
    const styleNode = { id: "cine-style", type: "style", position: { x: 0, y: 0 }, data: { label: "Style", style: "low-poly" } }
    const personNode = { id: "cine-person", type: "person", position: { x: 0, y: 0 }, data: { label: "Person", preText: "a weathered fisherman" } }
    // The Style node's edge first, so its wording is followed by another hint.
    const edges = [
      { id: "e1", source: "cine-style", target: "n1", targetHandle: "look" },
      { id: "e2", source: "cine-person", target: "n1", targetHandle: "look" },
    ]
    return { pickers: [styleNode, personNode], edges }
  }

  it("(j2) image-to-video: a Style node then a second look picker — the preview joins the hints as the run does", async () => {
    const { pickers, edges } = styleThenPerson()
    const i2vNode = makeNode("image-to-video", { prompt: "walking along the pier at dawn" })
    mockNodes = [...pickers, i2vNode]
    mockEdges = edges
    mockResolveNodeInputs.mockReturnValue({ imageUrl: "http://frame.png" })
    mockRunVideoGeneration.mockResolvedValue(undefined)

    await executeNode(i2vNode, makeCtx())

    expect(mockRunVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunVideoGeneration.mock.calls[0][8] as string
    const previewPrompt = assembleVideoPrompt("image-to-video", assemblerArgs(i2vNode))

    // The fold fired: the style's video wording (it ends a sentence), then the Person hint.
    const styleWording = getStyleVideoPromptHint("low-poly")
    expect(styleWording.endsWith(".")).toBe(true)
    expect(runPrompt).toContain(`${styleWording} a weathered fisherman`)
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(j3) text-to-video: a Style node then a second look picker — the preview joins the hints as the run does", async () => {
    const { pickers, edges } = styleThenPerson()
    const t2vNode = makeNode("text-to-video", { prompt: "a lighthouse in a storm" })
    mockNodes = [...pickers, t2vNode]
    mockEdges = edges
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(t2vNode, makeCtx())

    expect(mockRunTextToVideoGeneration).toHaveBeenCalledTimes(1)
    const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    const previewPrompt = assembleVideoPrompt("text-to-video", assemblerArgs(t2vNode))

    expect(runPrompt).toContain(`${getStyleVideoPromptHint("low-poly")} a weathered fisherman`)
    expect(previewPrompt).toBe(runPrompt)
  })

  // ── Node-data cinematic direction / structured ids (P4b) ─────────────────
  // The FRONTEND half of the keystone whose orchestrator half lives in
  // `backend/src/services/workflow-engine/__tests__/payload-builder-video-node-direction.test.ts`.
  // Both halves must agree on the SAME two things: a node carrying neither key
  // is byte-identical to before the leg, and a node carrying them folds them
  // exactly once, under the VIDEO verbosity policy, before mention resolution.
  //
  // These live in this file because it owns the only harness that runs the REAL
  // `execute-node` video handlers, and because the preview must fold identically
  // or the config panel would understate every direction-carrying video run —
  // the same three-site contract the still side pins.
  describe("stored direction / structured", () => {
    // Real catalog ids: every hint helper returns "" on a miss, so a made-up id
    // would make the fold assertions vacuously pass.
    const CAMERA_MOTION = "handheld" // MOTION dimension → compact term
    const STYLE = "cinematic" // LOOK dimension → full clause (on video: its video wording)

    /** Run a `generate-video` node and return the prompt the run actually sent.
     *  With a start frame it dispatches i2v, without one t2v — the two frontend
     *  branches a unified node is re-typed onto, and the two fold sites. */
    async function runGenerateVideo(
      data: Record<string, unknown>,
      opts: { startFrame?: boolean } = {},
    ): Promise<{ runPrompt: string; previewPrompt: string }> {
      const genVidNode = makeNode("generate-video", { provider: "seedance-2", ...data })
      mockNodes = [genVidNode]
      mockEdges = []
      mockResolveNodeInputs.mockReturnValue(
        opts.startFrame ? { startFrameUrl: "http://frame.png" } : {},
      )
      mockRunVideoGeneration.mockResolvedValue(undefined)
      mockRunTextToVideoGeneration.mockResolvedValue(undefined)

      await executeNode(genVidNode as any, makeCtx())

      const runPrompt = opts.startFrame
        ? (mockRunVideoGeneration.mock.calls[0][8] as string)
        : (mockRunTextToVideoGeneration.mock.calls[0][1] as string)
      return {
        runPrompt,
        previewPrompt: assembleVideoPrompt("generate-video", assemblerArgs(genVidNode)),
      }
    }

    for (const mode of [
      { name: "t2v (no frame)", startFrame: false },
      { name: "i2v (start frame)", startFrame: true },
    ]) {
      it(`(k) ${mode.name}: a node with NEITHER key is byte-identical to before the leg`, async () => {
        const body = "a knight rides at dusk"
        const baseline = await runGenerateVideo({ prompt: body }, mode)
        expect(baseline.runPrompt).toBe(body)
        expect(baseline.previewPrompt).toBe(body)

        // Junk is DROPPED by the narrow readers, never thrown on — a malformed
        // blob (a node written years ago by any client) must not change a byte.
        for (const junk of [
          { direction: "nope" },
          { direction: {} },
          { direction: { cameraMotion: 5 } },
          { direction: { cameraMotion: "" } },
          { structured: "nope" },
          { structured: { person: { age: "drop table" } } },
        ]) {
          vi.clearAllMocks()
          const out = await runGenerateVideo({ prompt: body, ...junk }, mode)
          expect(out.runPrompt, JSON.stringify(junk)).toBe(body)
          expect(out.previewPrompt, JSON.stringify(junk)).toBe(body)
        }
      })

      it(`(l) ${mode.name}: a motion id folds as its COMPACT term, once, in run and preview`, async () => {
        const { runPrompt, previewPrompt } = await runGenerateVideo(
          { prompt: "a knight rides at dusk", direction: { cameraMotion: CAMERA_MOTION } },
          mode,
        )
        const term = getCameraMotionTerm(CAMERA_MOTION)
        expect(term.length).toBeGreaterThan(0)
        // The video verbosity policy: the motion term, NOT the full clause.
        expect(getCameraMotionPromptHint(CAMERA_MOTION)).not.toBe(term)
        expect(runPrompt).toBe(`a knight rides at dusk. ${term}`)
        expect(previewPrompt).toBe(runPrompt)
      })

      it(`(m) ${mode.name}: a look id folds as its FULL clause into [style], structured ends the body`, async () => {
        const structured = { mood: "brooding" }
        const { runPrompt, previewPrompt } = await runGenerateVideo(
          { prompt: "a knight", direction: { style: STYLE }, structured },
          mode,
        )
        // A video run (and its preview) folds the style's VIDEO wording, never its image wording.
        const styleHint = getStyleVideoPromptHint(STYLE)
        const fragment = renderStructuredFields(structured)
        expect(styleHint.length).toBeGreaterThan(0)
        expect(styleHint).not.toBe(getStylePromptHint(STYLE))
        expect(fragment.length).toBeGreaterThan(0)
        // The section is what the preview has to reproduce byte-for-byte too —
        // the header and both newlines, not just the clause.
        expect(runPrompt).toBe(`a knight. ${fragment}\n\n[style]:\n${styleHint}`)
        expect(previewPrompt).toBe(runPrompt)
      })
    }

    it("(n) folds BEFORE mention resolution, so the @image_N binding still frames the body", async () => {
      // The fold must land on the prompt BODY — folding after the resolver would
      // push the look description past the identity directives, a worse version
      // of the bug the stored-ids channel exists to fix.
      const objNode = {
        id: "obj-1",
        type: "object",
        position: { x: 0, y: 0 },
        data: { label: "Gadget", objectName: "Gadget", sourceImageUrl: "http://r2/gadget.png" },
      }
      const genVidNode = makeNode("generate-video", {
        prompt: "spinning {image:1:gadget}",
        provider: "seedance-2",
        direction: { cameraMotion: CAMERA_MOTION },
      })
      mockNodes = [objNode, genVidNode]
      mockEdges = [
        { id: "e1", source: "obj-1", target: "n1", sourceHandle: "objectRef", targetHandle: "assets" },
      ]
      mockResolveNodeInputs.mockReturnValue({})
      mockRunTextToVideoGeneration.mockResolvedValue(undefined)

      await executeNode(genVidNode as any, makeCtx())

      const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
      const term = getCameraMotionTerm(CAMERA_MOTION)
      expect(runPrompt).toContain("the gadget from @image_1")
      expect(runPrompt).toContain(term)
      expect(runPrompt).not.toMatch(/\{image:1/)
      expect(assembleVideoPrompt("generate-video", assemblerArgs(genVidNode))).toBe(runPrompt)
    })

    it("(o) is ADDITIVE to a wired cinematography source — wired hint first, stored second", async () => {
      const personNode = {
        id: "cine-person",
        type: "person",
        position: { x: 0, y: 0 },
        data: { label: "Person", preText: "a weathered fisherman" },
      }
      const genVidNode = makeNode("generate-video", {
        prompt: "walking the pier",
        provider: "seedance-2",
        direction: { cameraMotion: CAMERA_MOTION },
      })
      mockNodes = [personNode, genVidNode]
      mockEdges = [{ id: "e1", source: "cine-person", target: "n1", targetHandle: "look" }]
      mockResolveNodeInputs.mockReturnValue({})
      mockRunTextToVideoGeneration.mockResolvedValue(undefined)

      await executeNode(genVidNode as any, makeCtx())

      const runPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
      const term = getCameraMotionTerm(CAMERA_MOTION)
      expect(runPrompt).toContain("a weathered fisherman")
      expect(runPrompt.indexOf(term)).toBeGreaterThan(runPrompt.indexOf("a weathered fisherman"))
      expect(assembleVideoPrompt("generate-video", assemblerArgs(genVidNode))).toBe(runPrompt)
    })
  })
})

// ===========================================================================
// AUDIO parity
// ===========================================================================

describe("preview↔run parity — audio", () => {
  it("(c) generate-music: run finalPrompt === assembleAudioPrompt('generate-music') — typed prompt + connected audio-style music-genre node", async () => {
    // Consumer: generate-music with a typed prompt. Upstream: a `music-genre`
    // node on the `audio-style` handle (a real audio-style source
    // collectAudioStyleHints folds in). `preText` forces a non-empty genre hint
    // without depending on catalog ids.
    const genreNode = {
      id: "genre-1",
      type: "music-genre",
      position: { x: 0, y: 0 },
      data: {
        label: "Music Genre",
        preText: "driving synthwave",
      },
    }
    const musicNode = makeNode("generate-music", {
      prompt: "an uplifting chorus",
      // MiniMax is reference-conditioned; the node refuses to run without one.
      referenceAudioUrl: "https://cdn.example/ref.mp3",
    })
    mockNodes = [genreNode, musicNode]
    mockEdges = [
      { id: "e1", source: "genre-1", target: "n1", targetHandle: "audio-style" },
    ]
    mockResolveNodeInputs.mockReturnValue({}) // no wired prompt

    await executeNode(musicNode as any, makeCtx())

    // generateMusicApi(finalPrompt@0, provider, duration, genre, mood, …).
    expect(generateMusicApi).toHaveBeenCalledTimes(1)
    const runPrompt = (generateMusicApi as any).mock.calls[0][0] as string

    const previewPrompt = assembleAudioPrompt("generate-music", assemblerArgs(musicNode))

    // Sanity: both the typed prompt and the folded style hint are present.
    expect(runPrompt).toContain("an uplifting chorus")
    expect(runPrompt).toContain("driving synthwave")
    expect(previewPrompt).toBe(runPrompt)
  })

  it("(d) voice-design: run voiceDescription === assembleAudioPrompt('voice-design') — typed voiceDescription + connected audio-style voice-character node", async () => {
    // Consumer: voice-design with a typed voiceDescription + preview `text`
    // (required input gate; NOT the prompt-equivalent field). Upstream: a
    // `voice-character` node on the `audio-style` handle — a voice source
    // voice-design accepts (music sources are rejected). The handler folds the
    // style into `finalVoiceDescription`, which it passes as voiceDesignApi's
    // SECOND positional arg.
    const voiceCharNode = {
      id: "voice-1",
      type: "voice-character",
      position: { x: 0, y: 0 },
      data: {
        label: "Voice Character",
        preText: "a gravelly noir narrator",
      },
    }
    const vdNode = makeNode("voice-design", {
      voiceDescription: "warm and confident",
      text: "The quick brown fox.", // preview text — satisfies the input gate
    })
    mockNodes = [voiceCharNode, vdNode]
    mockEdges = [
      { id: "e1", source: "voice-1", target: "n1", targetHandle: "audio-style" },
    ]
    mockResolveNodeInputs.mockReturnValue({}) // designText falls back to data.text

    await executeNode(vdNode as any, makeCtx())

    // voiceDesignApi(designText@0, finalVoiceDescription@1, options, userId).
    expect(mockVoiceDesignApi).toHaveBeenCalledTimes(1)
    const runVoiceDescription = mockVoiceDesignApi.mock.calls[0][1] as string

    const previewVoiceDescription = assembleAudioPrompt("voice-design", assemblerArgs(vdNode))

    // Sanity: typed description + folded voice-character hint both present.
    expect(runVoiceDescription).toContain("warm and confident")
    expect(runVoiceDescription).toContain("a gravelly noir narrator")
    expect(previewVoiceDescription).toBe(runVoiceDescription)
  })
})

// ===========================================================================
// SUNO parity (OBJECT — the whole assembled field set, not just a prompt string)
// ===========================================================================

describe("preview↔run parity — suno", () => {
  it("(suno) run sunoGenerateApi arg === assembleSunoPreview result — typed style/lyrics/title + connected picker (custom mode)", () => {
    // The suno run sends an ASSEMBLED OBJECT (not a single prompt string), so the
    // parity is field-for-field on the AssembleSunoResult. Both the run and the
    // preview call the SAME shared `assembleSunoInput`; this guards that they feed
    // it the same inputs (node + graph + refMap-resolved prompt/lyrics). Typed
    // style/title/lyrics auto-engage custom mode → the picker hint folds into STYLE.
    const genreNode = {
      id: "genre-1",
      type: "music-genre",
      position: { x: 0, y: 0 },
      data: { label: "Music Genre", preText: "driving synthwave" },
    }
    const sunoNode = makeNode("suno-generate", {
      prompt: "an epic anthem",
      style: "lo-fi",
      lyrics: "[verse] hello",
      title: "My Song",
      negativeStyle: "screaming",
      model: "V5",
      vocalGender: "female",
    })
    mockNodes = [genreNode, sunoNode]
    mockEdges = [
      { id: "e1", source: "genre-1", target: "n1", targetHandle: "audio-style" },
    ]
    mockResolveNodeInputs.mockReturnValue({}) // no wired prompt / persona

    return executeNode(sunoNode as any, makeCtx()).then(() => {
      // sunoGenerateApi({ ...assembleSunoResult, userId }) — capture arg 0.
      expect(sunoGenerateApi).toHaveBeenCalledTimes(1)
      const runArg = (sunoGenerateApi as any).mock.calls[0][0] as Record<string, unknown>
      // Strip the caller-only `userId` (the preview has no user context).
      const { userId: _userId, ...runResult } = runArg

      const previewResult = assembleSunoPreview({
        node: sunoNode,
        nodes: mockNodes as any,
        edges: mockEdges as any,
        refMap: buildNodeRefMap("n1", mockNodes as any, mockEdges as any),
      })

      // Sanity: custom mode engaged, the typed prompt is preserved, and the
      // connected picker folded into the STYLE field (alongside the typed style).
      expect(previewResult.customMode).toBe(true)
      expect(previewResult.prompt).toBe("an epic anthem")
      expect(previewResult.style).toContain("lo-fi")
      expect(previewResult.style).toContain("driving synthwave")
      expect(previewResult.lyrics).toBe("[verse] hello")
      expect(previewResult.title).toBe("My Song")

      // Field-for-field parity: the preview's assembled object equals what the run
      // sends (modulo the caller-only userId stripped above).
      expect(previewResult).toEqual(runResult)
    })
  })

  it("(suno-field) a field-style edge from a text source surfaces in the preview === the run's style (parity)", () => {
    // HEADLINE auto-inject scenario. At RUN, resolveFieldMappings (execute-node
    // ~892) rebinds data.style = the wired source's output BEFORE assembleSunoInput.
    // The PREVIEW must resolve the SAME `field-style` edge so the wired value
    // surfaces in the Final preview (preview==run). Before the fix the preview read
    // `data.style` RAW (empty) and showed NOTHING for the handle-wired field.
    //
    // Source = a `text-prompt` node, the task's named example. It is a parameter
    // node type, so BOTH the run's and the preview's resolveFieldMappings source
    // its value via the shared `getParameterValue` (reads `data.text`) — the exact
    // same path, which is the whole point of reusing the run's FE wrapper.
    const txtNode = {
      id: "txt-1",
      type: "text-prompt",
      position: { x: 0, y: 0 },
      data: { label: "Style Text", text: "neon synthwave, retro bass" },
    }
    // NO typed style — the ONLY way `style` is populated is via the field-style edge,
    // so the preview MUST resolve the edge or it shows nothing (the bug).
    const sunoNode = makeNode("suno-generate", { prompt: "an epic anthem" })
    mockNodes = [txtNode, sunoNode]
    mockEdges = [{ id: "e1", source: "txt-1", target: "n1", targetHandle: "field-style" }]
    mockResolveNodeInputs.mockReturnValue({}) // no wired prompt / persona

    return executeNode(sunoNode as any, makeCtx()).then(() => {
      expect(sunoGenerateApi).toHaveBeenCalledTimes(1)
      const runArg = (sunoGenerateApi as any).mock.calls[0][0] as Record<string, unknown>
      const { userId: _userId, ...runResult } = runArg

      const previewResult = assembleSunoPreview({
        node: sunoNode as any,
        nodes: mockNodes as any,
        edges: mockEdges as any,
        refMap: buildNodeRefMap("n1", mockNodes as any, mockEdges as any),
      })

      // The wired style surfaces in the preview (was undefined before the fix) …
      expect(previewResult.style).toContain("neon synthwave, retro bass")
      // … and the wired style auto-engages custom mode, exactly as the run does.
      expect(previewResult.customMode).toBe(true)
      // Field-for-field parity with the run.
      expect(previewResult).toEqual(runResult)
    })
  })
})

// ===========================================================================
// Unnamed Character nodes (decided 2026-11-11): the editor's Run names them as
// the workflow run does — each its own "Character N", in wire order, skipping a
// number another wired character is called. The literal names here are the
// workflow run's too (backend `payload-builder-unnamed-characters.test.ts`).
// ===========================================================================

describe("unnamed Character nodes — the editor's Run names them as the workflow run does", () => {
  function character(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      type: "character",
      position: { x: 0, y: 0 },
      data: {
        label: "Character Asset",
        characterName: "",
        sourceImageUrl: `http://${id}/portrait.png`,
        canonicalDescription: `the ${id} look`,
        expressions: [{ name: "smile", url: `http://${id}/smile.png` }],
        ...extra,
      },
    }
  }
  const wire = (source: string) => ({ id: `${source}->n1`, source, target: "n1", sourceHandle: "characterRef", targetHandle: "assets" })

  async function klingRun(chars: ReturnType<typeof character>[]) {
    const node = makeNode("generate-video", { prompt: "they walk out into the rain", provider: "kling-4" })
    mockNodes = [...chars, node]
    mockEdges = chars.map((c) => wire(c.id))
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)
    await executeNode(node as any, makeCtx())
    expect(mockRunTextToVideoGeneration).toHaveBeenCalledTimes(1)
    const [, prompt, , , options] = mockRunTextToVideoGeneration.mock.calls[0] as [string, string, unknown, string, { characterReferences?: Array<{ name: string; imageUrl: string }> }]
    return { node, prompt, subjects: options.characterReferences ?? [] }
  }

  it("Kling 4.0: two unnamed nodes are two subjects with different names; the preview prompt matches", async () => {
    const { node, prompt, subjects } = await klingRun([character("u1"), character("u2")])
    expect(subjects.map((s) => [s.name, s.imageUrl])).toEqual([
      ["Character 1", "http://u1/portrait.png"],
      ["Character 2", "http://u2/portrait.png"],
    ])
    expect(prompt).toContain("Character 1")
    expect(prompt).toContain("Character 2")
    expect(prompt).not.toContain("Character Asset")
    expect(assembleVideoPrompt("generate-video", assemblerArgs(node))).toBe(prompt)
  })

  it("a mixed list (named, unnamed, named, unnamed)", async () => {
    const { subjects } = await klingRun([
      character("a", { characterName: "Maya" }),
      character("b"),
      character("c", { characterName: "Leo" }),
      character("d"),
    ])
    expect(subjects.map((s) => s.name)).toEqual(["Maya", "Character 1", "Leo", "Character 2"])
  })

  it("an unnamed node beside one named Character 1 is Character 2", async () => {
    const { subjects } = await klingRun([character("u1"), character("named1", { characterName: "Character 1" })])
    expect(subjects.map((s) => s.name)).toEqual(["Character 2", "Character 1"])
  })

  async function imageRun(chars: ReturnType<typeof character>[]) {
    const node = makeNode("generate-image", { prompt: "a portrait in the rain", provider: "nano-banana-pro" })
    mockNodes = [...chars, node]
    mockEdges = chars.map((c) => wire(c.id))
    // What the editor's resolver hands a Character's wire: its portrait.
    mockResolveNodeInputs.mockReturnValue({ referenceImageUrls: chars.map((c) => c.data.sourceImageUrl) })
    mockRunImageGeneration.mockResolvedValue(undefined)
    await executeNode(node as any, makeCtx())
    expect(mockRunImageGeneration).toHaveBeenCalledTimes(1)
    const [, prompt, , refs] = mockRunImageGeneration.mock.calls[0] as [string, string, unknown, string[]]
    return { prompt, refs }
  }

  it("Generate Image: two unnamed nodes send both portraits and both identities", async () => {
    const { prompt, refs } = await imageRun([character("u1"), character("u2")])
    expect(refs).toEqual(["http://u1/portrait.png", "http://u2/portrait.png"])
    expect(prompt).toContain("(Character 1) — the u1 look")
    expect(prompt).toContain("(Character 2) — the u2 look")
    expect(prompt).not.toContain("Character Asset")
  })

  it("Generate Image: one unnamed node is Character 1; a typed label is the name", async () => {
    expect((await imageRun([character("u1")])).prompt).toContain("(Character 1) — the u1 look")
    mockRunImageGeneration.mockClear()
    expect((await imageRun([character("u1", { label: "Hero" })])).prompt).toContain("(Hero) — the u1 look")
  })

  // One image per character: the portrait is the node's output (entityImageUrl).
  const generated = { generatedResults: [{ url: "http://u1/result.png" }], activeResultIndex: 0 }

  it("source image + generated result, no starred asset: Generate Image sends exactly the result, one identity", async () => {
    for (const extra of [generated, { ...generated, characterName: "Maya" }]) {
      mockRunImageGeneration.mockClear()
      // The editor's resolver hands the wire the node's output: the result.
      const node = makeNode("generate-image", { prompt: "a portrait in the rain", provider: "nano-banana-pro" })
      const char = character("u1", extra)
      mockNodes = [char, node]
      mockEdges = [wire("u1")]
      mockResolveNodeInputs.mockReturnValue({ referenceImageUrls: ["http://u1/result.png"] })
      mockRunImageGeneration.mockResolvedValue(undefined)
      await executeNode(node as any, makeCtx())
      const [, prompt, , refs] = mockRunImageGeneration.mock.calls[0] as [string, string, unknown, string[]]
      expect(refs).toEqual(["http://u1/result.png"])
      expect(prompt.match(/^- Image \d/gm)).toHaveLength(1)
    }
  })

  it("Kling 4.0's subject starts with that same portrait", async () => {
    const { subjects } = await klingRun([character("u1", generated)])
    expect(subjects.map((s) => [s.name, s.imageUrl])).toEqual([["Character 1", "http://u1/result.png"]])
  })

  it("an old @character-asset mention reads as the one unnamed character; with two it stays plain; the preview agrees", async () => {
    const one = makeNode("generate-video", { prompt: "@character-asset:1 waves", provider: "kling-4" })
    mockNodes = [character("u1"), one]
    mockEdges = [wire("u1")]
    mockResolveNodeInputs.mockReturnValue({})
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)
    await executeNode(one as any, makeCtx())
    const resolved = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    expect(resolved).not.toContain("@character-asset")
    expect(assembleVideoPrompt("generate-video", assemblerArgs(one))).toBe(resolved)

    mockRunTextToVideoGeneration.mockClear()
    mockNodes = [character("u1"), character("u2"), one]
    mockEdges = [wire("u1"), wire("u2")]
    await executeNode(one as any, makeCtx())
    expect(mockRunTextToVideoGeneration.mock.calls[0][1] as string).toContain("@character-asset:1")
  })

  it("non-Latin names (he / ja / ko) are characters, under their own names", async () => {
    for (const typed of ["מאיה", "マヤ", "마야"]) {
      mockRunTextToVideoGeneration.mockClear()
      const { subjects } = await klingRun([character("u1"), character("x", { characterName: typed }), character("l", { characterName: "Leo" })])
      expect(subjects.map((s) => s.name)).toEqual(["Character 1", typed, "Leo"])
    }
  })
})
