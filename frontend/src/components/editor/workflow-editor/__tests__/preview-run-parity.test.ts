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
  // collectCinematographyHints now folds a character's wired Assets/Prompt
  // elements via resolveCharacterAssets — these fixtures wire no elements, so
  // empty channels are the correct stub.
  resolveCharacterAssets: vi.fn(() => ({ injectedAssets: "", facetInjections: [] })),
}))

vi.mock("../execution-graph", () => ({
  extractNodeOutput: (...args: unknown[]) => mockExtractNodeOutput(...args),
  detectPreviewItemType: (...args: unknown[]) => mockDetectPreviewItemType(...args),
  collectMediaAssets: (...args: unknown[]) => mockCollectMediaAssets(...args),
  buildAutoComposition: (...args: unknown[]) => mockBuildAutoComposition(...args),
  collectAncestorRefs: (...args: unknown[]) => mockCollectAncestorRefs(...args),
}))

vi.mock("../poll-job", () => ({
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
import { generateMusicApi } from "@/lib/api"
import { assembleVideoPrompt } from "@/lib/video-prompt-assembly"
import { assembleAudioPrompt } from "@/lib/audio-prompt-assembly"
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
