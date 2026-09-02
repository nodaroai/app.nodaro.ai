/**
 * §4.6b — the unresolved-`{Label}` guard on the FRONTEND single-node engine.
 *
 * `resolveTextRefs` leaves a `{Label}` LITERAL when the upstream has no value
 * and there is no `|| fallback`, and the canvas Run then sent those characters
 * to the provider ({Describe Image} ×2 on gpt-image-2, {gravity flip} /
 * {rewind} on two seedance-2-5 rows in the 2026-09-01 app-reports export).
 * Unlike the orchestrated path there is no "completed but produced no output"
 * backstop here.
 *
 * Substitute-then-refuse, identical to the DAG engine: a token naming a node
 * that EXISTS but produced nothing resolves to empty text (or its
 * `|| fallback`); only a token naming no node at all refuses — with a toast,
 * before any API call.
 *
 * SCOPE (fix round 1): the pass applies to AUTHOR-TYPED text only — the node's
 * own prompt fields and its promptPrefix / promptSuffix. Text that ARRIVES
 * through a wired edge or a list fan-out item is DATA and passes through
 * verbatim: JSON out of a Generate Text node legitimately contains `{...}`, and
 * the `{name || fallback}` escape is unreachable for text nobody authored.
 *
 * CROSS-ENGINE PARITY: the `typed prompt:` / `wired prompt:` / `affixes:` cases
 * below are named IDENTICALLY to their twins in
 * `backend/src/services/workflow-engine/__tests__/payload-builder-unresolved-refs.test.ts`
 * so a future divergence between the two engines is one grep away.
 *
 * Harness: the mock header is the proven one from `execute-node-composition.test.ts`
 * (`../node-input-resolver` is mocked down to `resolveNodeInputs`, so this file
 * deliberately drives a LEAN promptOf case — text-to-audio — whose path never
 * touches the un-mocked exports of that module).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock variables (declared before vi.mock calls)
// ---------------------------------------------------------------------------

// Apply writes to mockNodes so node state (e.g. currentJobId, read by the
// abandon-guard mid-poll) reflects what the real store would hold.
const mockUpdateNodeData = vi.fn((id: string, patch: Record<string, unknown>) => {
  const node = mockNodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
})
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
const mockRunLottiePlanGeneration = vi.fn()
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
const mockSunoGenerateApi = vi.fn()
const mockSunoCoverApi = vi.fn()
const mockSunoExtendApi = vi.fn()
const mockTextToAudioApi = vi.fn()
const mockTranscribeApi = vi.fn()
const mockGetJobStatus = vi.fn()
const mockLlmChatStream = vi.fn()
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
  getJobStatusLean: (...args: unknown[]) => mockGetJobStatus(...args),
  llmChatStream: (...args: unknown[]) => mockLlmChatStream(...args),
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
  textToAudioApi: (...args: unknown[]) => mockTextToAudioApi(...args),
  audioIsolationApi: vi.fn(),
  sunoGenerateApi: (...args: unknown[]) => mockSunoGenerateApi(...args),
  sunoCoverApi: (...args: unknown[]) => mockSunoCoverApi(...args),
  sunoExtendApi: (...args: unknown[]) => mockSunoExtendApi(...args),
  sunoLyricsApi: vi.fn(),
  sunoSeparateApi: vi.fn(),
  sunoMusicVideoApi: vi.fn(),
  transcribeApi: (...args: unknown[]) => mockTranscribeApi(...args),
  downloadYouTubeAudio: vi.fn(),
  lipSyncApi: vi.fn(),
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
  // The generate-video re-type cases below run the full text-to-video
  // composition path (resolveVideoPromptMentions), which unconditionally
  // touches these two — mirrors the pass-through mocks in
  // execute-node.test.ts. No fixture below wires a Character node, so a
  // pass-through / empty-map is behaviorally identical to the real stamp.
  stampElementInjections: (refs: unknown) => refs,
  collectCharacterElementInjections: () => new Map<string, string>(),
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
  runLottiePlanGeneration: (...args: unknown[]) =>
    mockRunLottiePlanGeneration(...args),
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
// Fixtures
//
// `text-to-audio` is the leanest node whose case calls `promptOf(...)` (the
// composed-prompt site) and whose only other input is `inputs.prompt` (the
// wired site) — so both composition points are observable on ONE node type,
// and the final string lands in `textToAudioApi`'s first argument.
// ---------------------------------------------------------------------------

const EMPTY_NOTES = { label: "Notes", text: "" }

/** Consumer node (id "n1", label "Hero" — the backend twin's label). */
function hero(data: Record<string, unknown> = {}) {
  return makeNode("text-to-audio", { label: "Hero", ...data })
}

/** Seed the store with the consumer + a `Notes` source wired into it. The
 *  source is in the GRAPH but (by default) produced nothing —
 *  `mockExtractNodeOutput` returns undefined — which is exactly the shape the
 *  orchestrator leaves behind for a blank optional input. */
function seed(consumer: any, notesData: Record<string, unknown> = EMPTY_NOTES) {
  mockNodes = [
    consumer,
    { id: "t-1", type: "text-prompt", position: { x: 0, y: 0 }, data: notesData },
  ]
  mockEdges = [{ id: "e1", source: "t-1", target: "n1" }]
}

/** Run the node to completion and return the prompt that reached the API. */
async function promptSentFor(consumer: any, inputs: Record<string, unknown> = {}, override?: string) {
  mockResolveNodeInputs.mockReturnValue(inputs)
  mockPollJobWithNodeUpdate.mockResolvedValue(undefined)
  await executeNode(consumer, makeCtx(), override)
  const apiCallFn = mockPollJobWithNodeUpdate.mock.calls[0][1]
  mockTextToAudioApi.mockResolvedValue({ jobId: "ta-j1" })
  await apiCallFn()
  return mockTextToAudioApi.mock.calls[0][0] as string
}

/** Start a run that is expected to refuse; the caller asserts on the promise. */
function runExpectingRefusal(consumer: any, inputs: Record<string, unknown> = {}) {
  mockResolveNodeInputs.mockReturnValue(inputs)
  const promise = executeNode(consumer, makeCtx())
  promise.catch(() => {})
  return promise
}

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

describe("unresolved {Label} guard (single-node engine)", () => {
  it("refuses a single-node run whose prompt still carries an unresolvable {Label}", async () => {
    const n = hero({ prompt: "a {gravity flip} of a car" })
    seed(n)
    await expect(runExpectingRefusal(n)).rejects.toThrow(/unresolved reference/i)
  })

  it("names the token so the user can fix it", async () => {
    const n = hero({ prompt: "a {gravity flip} of a car" })
    seed(n)
    await expect(runExpectingRefusal(n)).rejects.toThrow(/gravity flip/)
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringContaining("{gravity flip}"),
    )
  })

  it("names the node and the escape hatch, and carries a stable code", async () => {
    const n = hero({ prompt: "a {gravity flip} of a car" })
    seed(n)
    try {
      await runExpectingRefusal(n)
      throw new Error("expected a refusal")
    } catch (err) {
      const e = err as Error & { code?: string }
      expect(e.code).toBe("unresolved_reference")
    }
    const message = mockToastError.mock.calls[0][0] as string
    expect(message).toContain('"Hero"')
    expect(message).toContain("{name || fallback}")
  })

  it("refuses BEFORE the API call, so nothing is dispatched and no credits are reserved", async () => {
    const n = hero({ prompt: "a {gravity flip} of a car" })
    seed(n)
    await expect(runExpectingRefusal(n)).rejects.toThrow(/unresolved reference/i)
    expect(mockPollJobWithNodeUpdate).not.toHaveBeenCalled()
    expect(mockTextToAudioApi).not.toHaveBeenCalled()
  })

  it("allows a run whose reference resolves", async () => {
    const n = hero({ prompt: "a {Notes} scene" })
    seed(n, { label: "Notes", text: "sunset" })
    // `mockImplementationOnce`, not `mockImplementation`: vi.clearAllMocks()
    // clears call history but NOT implementations, and a drift detector must
    // not be order-dependent on a leaked one.
    mockExtractNodeOutput.mockImplementationOnce((node: any) => node?.data?.text)
    expect(await promptSentFor(n)).toBe("a sunset scene")
  })

  // --- Composition point 1: the node's own (typed) prompt, via promptOf ---

  it("typed prompt: an empty existing node contributes empty text, not the literal", async () => {
    const n = hero({ prompt: "write {Notes} about cats" })
    seed(n)
    const sent = await promptSentFor(n)
    expect(sent).toBe("write about cats") // token gone, double space collapsed
    expect(sent).not.toContain("{")
  })

  it("typed prompt: an empty existing node WITH a fallback contributes the fallback", async () => {
    const n = hero({ prompt: "write {Notes || nothing} about cats" })
    seed(n)
    expect(await promptSentFor(n)).toBe("write nothing about cats")
  })

  it("typed prompt: a label naming no node in the graph still refuses", async () => {
    const n = hero({ prompt: "write {Notes} about {NotANode}" })
    seed(n)
    await expect(runExpectingRefusal(n)).rejects.toThrow(/\{NotANode\}/)
    expect(mockToastError.mock.calls[0][0]).not.toContain("{Notes}")
  })

  // Prompt affixes ride the SAME composition point: computeNodePrompt wraps the
  // core via applyPromptAffixes, so promptPrefix / promptSuffix text is inside
  // the string the guard sees. Without that, a `{Label}` typed into an affix
  // would bypass both the refusal and the substitution.
  it("affixes: a nonexistent {Label} in promptPrefix refuses", async () => {
    const n = hero({ prompt: "a car", promptPrefix: "{NotANode} style," })
    seed(n)
    await expect(runExpectingRefusal(n)).rejects.toThrow(/\{NotANode\}/)
  })

  it("affixes: an empty existing node in promptSuffix substitutes to empty text", async () => {
    const n = hero({ prompt: "a car", promptSuffix: "shot {Notes} today" })
    seed(n)
    const sent = await promptSentFor(n)
    expect(sent).toContain("shot today")
    expect(sent).not.toContain("{Notes}")
  })

  // --- Wired / fan-out text is DATA: the guard must not touch it (fix round 1) ---
  //
  // These three are the INVERSE of the backend file's `wired prompt:` cases as
  // originally written; the backend mirror in task-14-report.md §"Backend parity
  // follow-up" flips them the same way. A `{` that arrived over an edge is a
  // character the upstream node emitted, and no one can add `{name || fallback}`
  // to text they did not type.

  it("wired prompt: text arriving from an edge is data — passed through verbatim", async () => {
    const n = hero({})
    seed(n)
    expect(await promptSentFor(n, { prompt: "wired {Notes} tail" }))
      .toBe("wired {Notes} tail")
  })

  it("wired prompt: a {NotANode} arriving from an edge does NOT refuse", async () => {
    const n = hero({})
    seed(n)
    expect(await promptSentFor(n, { prompt: "wired {NotANode} tail" }))
      .toBe("wired {NotANode} tail")
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("wired prompt: JSON from an upstream node reaches the provider unchanged", async () => {
    const n = hero({})
    seed(n)
    const json = '{"shot": "wide", "lens": "35mm"}'
    expect(await promptSentFor(n, { prompt: json })).toBe(json)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("fan-out override text is data too — passed through verbatim", async () => {
    const n = hero({})
    seed(n)
    expect(await promptSentFor(n, {}, 'item {"k": 1} {NotANode}'))
      .toBe('item {"k": 1} {NotANode}')
    expect(mockToastError).not.toHaveBeenCalled()
  })

  // Adversarial: BOTH halves of the rule on one node. The typed affix must
  // still refuse, and the refusal must name ONLY the authored token — the
  // missing label riding in on the wire is data and is never reported.
  it("wired data + a typed {NotANode} affix: refuses, naming only the typed token", async () => {
    const n = hero({ promptPrefix: "{NotANode} style," })
    seed(n)
    mockResolveNodeInputs.mockReturnValue({ prompt: "wired {AlsoMissing} tail" })
    const promise = executeNode(n, makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow(/\{NotANode\}/)
    const message = mockToastError.mock.calls[0][0] as string
    expect(message).toContain("{NotANode}")
    expect(message).not.toContain("AlsoMissing")
  })

  it("passes a token with an explicit fallback, and substitutes it", async () => {
    // Nothing upstream produced anything, so the ref map is EMPTY and
    // `resolvePrompt`'s `rr` helper skips ref resolution entirely — an
    // explicitly-escaped `{x || y}` used to reach the provider as characters.
    const n = hero({ prompt: "a {mood || calm} scene" })
    mockNodes = [n]
    mockEdges = []
    expect(await promptSentFor(n)).toBe("a calm scene")
  })

  it("never fires on the reference/recast grammars, and leaves them intact", async () => {
    const n = hero({ prompt: "use {image:1:face} and {slot:hero} and {ref:car}" })
    mockNodes = [n]
    mockEdges = []
    // Not refused AND not stripped: their own resolvers run further down.
    const sent = await promptSentFor(n)
    expect(sent).toContain("{slot:hero}")
    expect(sent).toContain("{ref:car}")
  })
})

// ---------------------------------------------------------------------------
// FieldMapping / `{}` injection — the second way DATA reaches a "typed" field
//
// `resolveFieldMappings` rewrites `node.data.<field>` with an UPSTREAM node's
// output BEFORE the prompt is composed, so by the time the settle pass reads
// `data.prompt` the value may be text nobody typed. The pass therefore treats a
// candidate field as authored only while it still equals the snapshot taken
// before the mapping block ran.
// ---------------------------------------------------------------------------

describe("field mapping: injected upstream text is data, not an authored prompt", () => {
  const JSON_OUT = '{"k": "v"}'

  it("{} injection: JSON written into data.prompt does not refuse and ships verbatim", async () => {
    const n = hero({ prompt: "{}" })
    seed(n)
    expect(await promptSentFor(n, { prompt: JSON_OUT })).toBe(JSON_OUT)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("a mapped field is data even when the mapping wrote a {NotANode}", async () => {
    const n = hero({ prompt: "{}" })
    seed(n)
    expect(await promptSentFor(n, { prompt: "upstream {NotANode} text" }))
      .toBe("upstream {NotANode} text")
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("the same node's typed promptSuffix is still authored — and still refuses", async () => {
    const n = hero({ prompt: "{}", promptSuffix: "{NotANode} style" })
    seed(n)
    mockResolveNodeInputs.mockReturnValue({ prompt: JSON_OUT })
    const promise = executeNode(n, makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow(/\{NotANode\}/)
    const message = mockToastError.mock.calls[0][0] as string
    expect(message).toContain("{NotANode}")
    // The injected JSON is data — its brace token is never reported.
    expect(message).not.toContain('"k"')
  })
})

// ---------------------------------------------------------------------------
// generate-video re-type recursion — the THIRD way DATA reaches a "typed"
// field.
//
// `generate-video` re-types itself to `text-to-video` / `image-to-video` and
// RECURSES into `executeNode` (execute-node.ts's only `return executeNode(`
// call site) so the existing i2v/t2v cases can dispatch it. The synthetic
// node it builds carries `node.data` AFTER the outer call's field-mapping
// block already ran — so a mapping-injected value (e.g. a JSON blob mapped
// into `data.prompt`) is sitting in the field the inner call would otherwise
// re-snapshot as "authored." Passing the OUTER pre-mapping snapshot through
// (`authoredOverride`) keeps the inner call's settle pass agreeing that the
// field is DATA, not something the user typed.
// ---------------------------------------------------------------------------

describe("generate-video re-type recursion: mapping-injected prompt survives as data", () => {
  // `vi.clearAllMocks()` in the file-level `beforeEach` clears call history but
  // not a configured `mockReturnValue` — reset it explicitly so it doesn't leak
  // into unrelated describe blocks below (e.g. cross-engine parity).
  afterEach(() => {
    mockExtractNodeOutput.mockReturnValue(undefined)
  })

  it("a mapping that injects {\"k\":1} into a generate-video prompt does not refuse and ships verbatim", async () => {
    const n = makeNode("generate-video", {
      fieldMappings: { prompt: { sourceNodeId: "src-1" } },
    })
    mockNodes = [
      n,
      { id: "src-1", type: "generate-text", position: { x: 0, y: 0 }, data: { label: "Draft" } },
    ]
    mockEdges = []
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue('{"k":1}')
    mockRunTextToVideoGeneration.mockResolvedValue(undefined)

    await executeNode(n, makeCtx())

    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockRunTextToVideoGeneration).toHaveBeenCalled()
    const passedPrompt = mockRunTextToVideoGeneration.mock.calls[0][1] as string
    expect(passedPrompt).toBe('{"k":1}')
  })

  it("the same node's typed promptSuffix is still authored — and still refuses, naming only that token", async () => {
    const n = makeNode("generate-video", {
      fieldMappings: { prompt: { sourceNodeId: "src-1" } },
      promptSuffix: "{NotANode}",
    })
    mockNodes = [
      n,
      { id: "src-1", type: "generate-text", position: { x: 0, y: 0 }, data: { label: "Draft" } },
    ]
    mockEdges = []
    mockResolveNodeInputs.mockReturnValue({})
    mockExtractNodeOutput.mockReturnValue('{"k":1}')

    const promise = executeNode(n, makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow(/\{NotANode\}/)
    expect(mockRunTextToVideoGeneration).not.toHaveBeenCalled()
    const message = mockToastError.mock.calls[0][0] as string
    expect(message).toContain("{NotANode}")
    // The mapping-injected prompt is data — its brace token is never reported.
    expect(message).not.toContain('"k"')
  })
})

// ---------------------------------------------------------------------------
// LLM Chat — the flow fix round 1 was ruled on
//
// "Generate Text emits JSON -> LLM Chat reformats it" is an everyday canvas
// flow. Before the rescope, the eager pass over `inputs.prompt` refused it on
// click, with no escape available: `{name || fallback}` needs an author, and
// the JSON was written by a model.
// ---------------------------------------------------------------------------

describe("llm-chat: wired data is never refused", () => {
  function chat(data: Record<string, unknown> = {}) {
    return makeNode("llm-chat", { label: "Writer", ...data })
  }
  async function userInputSentFor(n: any, inputs: Record<string, unknown> = {}) {
    mockResolveNodeInputs.mockReturnValue(inputs)
    mockLlmChatStream.mockResolvedValue({ generatedText: "ok", jobId: "j1" })
    await executeNode(n, makeCtx())
    return (mockLlmChatStream.mock.calls[0][0] as { userInput: string }).userInput
  }

  it("wired JSON from an upstream node runs and reaches the model verbatim", async () => {
    const n = chat({})
    mockNodes = [n, { id: "t-1", type: "generate-text", position: { x: 0, y: 0 }, data: { label: "Draft" } }]
    mockEdges = [{ id: "e1", source: "t-1", target: "n1" }]
    const json = '{"shot": "wide", "beats": ["a", "b"]}'
    expect(await userInputSentFor(n, { prompt: json })).toBe(json)
    expect(mockToastError).not.toHaveBeenCalled()
  })

  // Concern 3 / ticket FE-3, pinned as-is rather than fixed: llm-chat composes
  // through `computeLlmChatFields`, not `promptOf`, so its TYPED userInput /
  // systemPrompt are outside the guard on BOTH engines. The coordinator's fix
  // round asked for a typed refusal "in the same node"; that is not reachable
  // while concern 3 stays deferred, so the typed half is pinned on a node whose
  // typed prompt IS guarded (below) and the gap is pinned here. Flipping this
  // expectation is exactly what closing FE-3 looks like.
  it("a typed {NotANode} does NOT refuse yet — the computeLlmChatFields gap (ticket FE-3)", async () => {
    const n = chat({ userInput: "rewrite {NotANode} please" })
    mockNodes = [n]
    mockEdges = []
    expect(await userInputSentFor(n)).toBe("rewrite {NotANode} please")
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it("the typed half of the rule, on a promptOf node: {NotANode} refuses", async () => {
    const n = hero({ prompt: "rewrite {NotANode} please" })
    seed(n)
    await expect(runExpectingRefusal(n)).rejects.toThrow(/\{NotANode\}/)
  })
})

// ---------------------------------------------------------------------------
// Cross-engine parity
// ---------------------------------------------------------------------------

describe("cross-engine parity with the DAG engine", () => {
  // The same three prompts the backend guard is pinned on
  // (payload-builder-unresolved-refs.test.ts): a label naming NO node refuses,
  // a label naming an EMPTY node becomes empty text, and a label with a
  // fallback becomes the fallback. If this ever disagrees with the backend
  // file, one of the two engines has drifted.
  it("the same three prompts refuse / empty / fallback on both engines", async () => {
    const refused = hero({ prompt: "a {NotANode} scene" })
    seed(refused)
    await expect(runExpectingRefusal(refused)).rejects.toThrow(/unresolved reference/i)

    vi.clearAllMocks()
    const empty = hero({ prompt: "a {Notes} scene" })
    seed(empty)
    expect(await promptSentFor(empty)).toBe("a scene")

    vi.clearAllMocks()
    const fallback = hero({ prompt: "a {Notes || calm} scene" })
    seed(fallback)
    expect(await promptSentFor(fallback)).toBe("a calm scene")
  })
})
