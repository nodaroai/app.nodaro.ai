import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mock state — declared before vi.mock() calls
// ---------------------------------------------------------------------------

const {
  mockCheckCredits,
  mockReserveCredits,
  mockProbeMediaDuration,
  mockGetAppSettings,
  mockSeedance2FromUrls,
  mockSeedance2FromDurations,
  mockH3FromUrls,
  mockH3FromDurations,
  mockH3RefImageCount,
  mockJobDelete,
  mockJobInsert,
  built,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockProbeMediaDuration: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockSeedance2FromUrls: vi.fn(),
  mockSeedance2FromDurations: vi.fn(),
  mockH3FromUrls: vi.fn(),
  mockH3FromDurations: vi.fn(),
  mockH3RefImageCount: vi.fn(),
  mockJobDelete: vi.fn(),
  mockJobInsert: vi.fn(),
  // Mutable so a test can dispatch a different provider / reference set.
  built: {
    result: {} as Record<string, unknown>,
  },
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
  // `mockJobDelete` records the deleted id so a test can assert the placeholder
  // jobs row is GONE when the duration gate rejects.
  const deleteFn = vi.fn().mockReturnValue({ eq: mockJobDelete.mockResolvedValue({ error: null }) })
  const singleFn = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = mockJobInsert.mockReturnValue({ select: selectFn })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: insertFn,
        update: updateFn,
        delete: deleteFn,
        select: vi.fn(),
      }),
    },
  }
})

// The rows the hold reads (DB-first at run time; here the approved figures).
const ROWS = vi.hoisted((): Record<string, number> => ({ "kling-4:5s:1080p": 540, "kling-4:5s:4k": 1240, "kling-4-hdr:5s:1080p": 110, "kling-4-hdr:5s:4k": 180 }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: {
    checkCredits: mockCheckCredits,
    reserveCredits: mockReserveCredits,
  },
  getModelCreditBaseCost: async (id: string) => {
    if (ROWS[id] === undefined) throw new Error(`unpriced ${id}`)
    return { creditCost: ROWS[id] }
  },
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

// Markup source — node-executor mirrors the route guard (base → ceil(base × (1+markup%))).
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

// The shared ee billing helper is loaded via DYNAMIC import in node-executor;
// mocking the module id intercepts that dynamic import too.
vi.mock("@/ee/billing/seedance2-ref-video-credits.js", () => ({
  seedance2RefVideoBaseCreditsFromUrls: mockSeedance2FromUrls,
  seedance2RefVideoBaseCreditsFromDurations: mockSeedance2FromDurations,
}))

vi.mock("@/ee/billing/minimax-h3-credits.js", () => ({
  minimaxH3BaseCreditsFromUrls: mockH3FromUrls,
  minimaxH3BaseCreditsFromDurations: mockH3FromDurations,
  minimaxH3BillableRefImageCount: mockH3RefImageCount,
  MINIMAX_H3_FREE_INPUT_IMAGES: 5,
}))

// ffmpeg probe (also referenced by the shared helper; mocked for safety).
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: mockProbeMediaDuration }))

// payload-builder stub: a Seedance 2 i2v node with a connected reference video.
// The orchestrator reads provider/resolution/duration/referenceVideoUrls from
// the built payload to compute the override.
vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => built.result),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "n1", type: "image-to-video", data: {} }, appliedMappings: [] }),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({}))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))
// @nodaro/prompts was mocked whole here; split per entry, the entries without an override stay mocked empty (tools/package-entries/codemod.mjs).
vi.mock("@nodaro/prompts/assembly", () => ({
  appendField: vi.fn((a: string) => a), appendMusicMeta: vi.fn(), assembleImageInput: vi.fn(() => ({ prompt: "", referenceImageUrls: [] })),
  assembleSunoInput: vi.fn(() => ({})), composeSoundHintFromConnections: vi.fn(() => null), resolveVideoReferenceCore: vi.fn(() => ({})),
  truncateForField: vi.fn((s: string) => s),
}))
vi.mock("@nodaro/prompts/catalog-packs", () => ({}))
vi.mock("@nodaro/prompts/doctrine", () => ({
  buildCharacterPrompt: vi.fn(() => ""), buildCreaturePrompt: vi.fn(() => ""),
  buildFaceTemplateInputs: vi.fn(() => ({})), buildLocationPrompt: vi.fn(() => ""),
  buildObjectPrompt: vi.fn(() => ""), characterLockToRefLock: vi.fn(),
  collectIdentityLockClause: vi.fn(() => ""),
}))
vi.mock("@nodaro/prompts/person", () => ({}))
vi.mock("@nodaro/prompts/picker-art", () => ({}))
vi.mock("@nodaro/prompts/picker-catalogs", () => ({
  getParameterPromptHint: vi.fn(() => ""), pickerFanoutTargets: vi.fn(() => []),
}))
vi.mock("@nodaro/prompts/pickers", () => ({}))
vi.mock("@nodaro/prompts/presets", () => ({}))
vi.mock("@nodaro/prompts/prompt-builder", () => ({
  buildImagePrompt: vi.fn(() => ({ prompt: "" })), buildScenePrompt: vi.fn(() => ""),
}))
vi.mock("@nodaro/prompts/prompt-fields", () => ({}))
// Partial mock: the engine-shaped helpers stay stubbed, but everything the
// reference-video duration gate reads (VIDEO_REF_VIDEO_DURATION_LIMITS,
// checkRefVideoDurations, VIDEO_REF_LIMITS_BY_PROVIDER, isMinimaxH3Provider)
// comes from the REAL package — the whole point is to exercise the shipped
// bounds, not a re-typed copy of them.
vi.mock("@nodaro/shared/apps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/apps")>()),
  mergeExposedSettings: vi.fn().mockReturnValue({ settings: {}, exposedSettingValues: {} }),
  applyHandleInputOverride: vi.fn().mockImplementation((_e: unknown, node: unknown) => node),
  isHandleInputWired: vi.fn().mockReturnValue(false),
}))
vi.mock("@nodaro/shared/social", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/social")>()),
  SOCIAL_POST_NODE_TYPES: new Set<string>(),
}))
vi.mock("@nodaro/shared/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/shared/workflow")>()),
  resolveNodeRefs: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

/**
 * Kling 4.0 HDR in a workflow run (decided 2026-11-22): the hold is the clip's
 * price plus the HDR add-on's own row on the output seconds, marked up once,
 * as the routes hold it (`withVideoHdrAddon`): with no reference video
 * (`computeVideoHdrCreditOverride`) and with one (the reference-video
 * override, whose clip seconds never move the add-on). An SDR run's hold is
 * the identifier's price as before (no override).
 */
const node: SimpleNode = { id: "n1", type: "generate-video", data: { provider: "kling-4" } }
const ctx = { executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual", cancelled: false, isAppRun: false, onJobCreated: vi.fn() } as unknown as OrchestratorContext

function dispatch(payload: Record<string, unknown>, modelIdentifier: string, jobName = "text-to-video"): void {
  built.result = { jobName, queueName: "video-generation", modelIdentifier, payload: { jobId: "test-job-id", provider: "kling-4", duration: 5, ...payload } }
}

async function heldOverride(): Promise<number | undefined> {
  await expect(executeNode(node, {}, [], [], {}, ctx)).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)
  const options = mockReserveCredits.mock.calls[0]![5] as { creditOverride?: number } | undefined
  return options?.creditOverride
}

describe("node-executor — Kling 4.0 HDR hold", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockProbeMediaDuration.mockResolvedValue(12)
    mockSeedance2FromDurations.mockReturnValue(1084)
    mockSeedance2FromUrls.mockResolvedValue(1084)
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50_000, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
  })

  it("HDR with no reference video: the clip's row plus the add-on's, at both HDR sizes", async () => {
    dispatch({ resolution: "1080p", dynamicRange: "hdr" }, "kling-4:5s:1080p")
    await expect(heldOverride()).resolves.toBe(540 + 110)
    vi.clearAllMocks()
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50_000, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
    dispatch({ resolution: "4k", dynamicRange: "hdr" }, "kling-4:5s:4k")
    await expect(heldOverride()).resolves.toBe(1240 + 180)
  })

  it("HDR with a reference video: the reference-video base plus the add-on", async () => {
    dispatch({ resolution: "1080p", dynamicRange: "hdr", referenceVideoUrls: ["https://ref.mp4"] }, "kling-4:5s:1080p-ref", "image-to-video")
    await expect(heldOverride()).resolves.toBe(1084 + 110)
  })

  it("an SDR run is held at the identifier's price, as before (no override)", async () => {
    dispatch({ resolution: "1080p" }, "kling-4:5s:1080p")
    await expect(heldOverride()).resolves.toBeUndefined()
  })
})
