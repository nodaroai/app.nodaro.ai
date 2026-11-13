/**
 * Add Captions transcribing on Nemotron 3.5 Transcribe on a workflow run
 * (decided 2026-11-13): the video is measured BEFORE anything is reserved
 * (`stampAddCaptionsNemotronInput`, the route preHandler's twin), so
 *   - a video the route would refuse (over 60 minutes) leaves NO jobs row and
 *     no reservation, and the node fails with the route's own code;
 *   - a measurable video reserves the render plus its minutes,
 *     `add-captions:kinetic:nemotron:<N>m`, at the affordability preflight and
 *     the reservation alike, and the payload carries the hold to settle on;
 *   - an install that relays the transcription reserves the render alone.
 *
 * Harness cloned from node-executor-video-depth-reserve.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockCheckCredits,
  mockReserveCredits,
  mockProbeVideoSource,
  mockGetAppSettings,
  mockDeleteEq,
  built,
  perMinute,
} = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockProbeVideoSource: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockDeleteEq: vi.fn(),
  built: { result: {} as Record<string, unknown> },
  perMinute: { value: false },
}))

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
  const deleteFn = vi.fn().mockReturnValue({ eq: mockDeleteEq })
  const singleFn = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({ insert: insertFn, update: updateFn, delete: deleteFn, select: vi.fn() }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

// The Nemotron caption stamp (lib/add-captions-nemotron.ts) measures through this module.
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  probeVideoSource: mockProbeVideoSource,
  probeMediaDuration: vi.fn(),
  assertSafeProbeSource: vi.fn(async () => {}),
  probeMediaDurationAndSize: async (url: string) => {
    const probed = await mockProbeVideoSource(url)
    return { durationSec: probed.durationSeconds, sizeBytes: probed.sizeBytes }
  },
}))
/** Whether this install relays a Nemotron transcription to the cloud (keyless, connected). */
const cloud = vi.hoisted(() => ({ relays: false }))
vi.mock("@/providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: async () => cloud.relays }))

// Per started minute (decided 2026-10-07): the capability the executor asks.
vi.mock("@/lib/private-plugins/edit-plan-per-minute.js", () => ({ editPlanPerMinuteActive: async () => perMinute.value }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn((..._args: unknown[]) => built.result),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "ac1", type: "add-captions", data: {} }, appliedMappings: [] }),
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
vi.mock("@nodaro/prompts/prompt-fields", () => ({
  computeLlmChatFields: vi.fn(), computeNodePrompt: vi.fn(), applyPromptAffixes: vi.fn((s: string) => s),
}))
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

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import { addCaptionsNemotronMinutesId } from "@nodaro/shared/credits"

function makeNode(): SimpleNode {
  return { id: "ac1", type: "add-captions", data: {} }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual",
    cancelled: false, isAppRun: false, onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

describe("node-executor — Add Captions on Nemotron measures the video before reserving", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cloud.relays = false
    mockDeleteEq.mockResolvedValue({ error: null })
    mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
    mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50000, watermark: false })
    mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
    perMinute.value = false
    built.result = {
      jobName: "add-captions",
      queueName: "video-generation",
      modelIdentifier: "add-captions:kinetic",
      payload: {
        jobId: "test-job-id",
        videoUrl: "https://cdn.example/talk.mp4",
        style: "word-highlight",
        transcribe_provider: "nemotron-3-5-transcribe",
      },
    }
  })

  it("a 9:30 video reserves the render plus 10 minutes at BOTH gates, and the payload carries the hold", async () => {
    mockProbeVideoSource.mockResolvedValue({ durationSeconds: 570, sizeBytes: 800 * 1024 * 1024 })
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)
    expect((mockCheckCredits.mock.calls[0] as unknown[])[1]).toBe(addCaptionsNemotronMinutesId(10))
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe(addCaptionsNemotronMinutesId(10))
    expect(built.result.payload).toMatchObject({ duration_seconds: 570, bucketKey: addCaptionsNemotronMinutesId(10) })
  })

  it("a video over 60 minutes is refused with the route's code: the jobs row is deleted and nothing is reserved", async () => {
    mockProbeVideoSource.mockResolvedValue({ durationSeconds: 3700 })
    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).then(
      () => { throw new Error("executeNode should have refused the video") },
      (e: unknown) => e as Error & { errorCode?: string },
    )
    expect(err.errorCode).toBe("media_duration_exceeds_limit")
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "test-job-id")
    expect(mockCheckCredits).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })

  it("relayed to the cloud (a keyless install): the render alone is reserved, nothing measured", async () => {
    cloud.relays = true
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe("add-captions:kinetic")
    expect(mockProbeVideoSource).not.toHaveBeenCalled()
    expect((built.result.payload as Record<string, unknown>).bucketKey).toBeUndefined()
  })

  it("another engine: the render's own row, nothing measured", async () => {
    ;(built.result.payload as Record<string, unknown>).transcribe_provider = "elevenlabs-stt"
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toThrow(/reservation-sentinel|Credit reservation failed/)
    expect((mockReserveCredits.mock.calls[0] as unknown[])[2]).toBe("add-captions:kinetic")
    expect(mockProbeVideoSource).not.toHaveBeenCalled()
  })
})
