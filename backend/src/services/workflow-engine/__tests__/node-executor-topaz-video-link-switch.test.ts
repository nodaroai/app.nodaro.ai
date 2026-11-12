/**
 * A run's Topaz video upscale node (node-executor.ts) and the deployment's
 * link-import switch: the lane's stamp asks it before the clip is read. Where
 * link imports are off, a clip from another site fails the node with
 * `link_imports_disabled`, its placeholder jobs row removed, nothing read,
 * reserved or queued. A clip on this deployment's own storage, or any clip
 * with links on, goes on to the reservation as before.
 *
 * Every external dependency is stubbed, as in node-executor-nodaro-image-upscale-stamp.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { built, mockProbe, mockCheckCredits, mockReserveCredits, mockQueueAdd, mockDiscardScratch, deleteThrows } = vi.hoisted(() => ({
  mockDiscardScratch: vi.fn(async (_jobId: string) => undefined),
  deleteThrows: { value: false },
  built: { payload: {} as Record<string, unknown> },
  mockProbe: vi.fn(async () => ({ width: 1280, height: 720, durationSeconds: 5, videoDurationSeconds: 5, fps: 30 })),
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

vi.mock("@/lib/content-restriction-gate.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/content-restriction-gate.js")>("@/lib/content-restriction-gate.js")
  return { ...actual, restrictedInputKey: vi.fn(async () => null) }
})
vi.mock("@/lib/job-scratch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-scratch.js")>()),
  discardDeletedJobScratch: mockDiscardScratch,
}))
// Reading the clip: what the stamp measures before anything is held.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: mockProbe,
}))

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: mockCheckCredits, reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => ({
    jobName: "video-upscale",
    queueName: "video-generation",
    modelIdentifier: "topaz-video:per-unit",
    payload: built.payload,
  })),
}))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockReturnValue({ node: { id: "n1", type: "video-upscale", data: {} }, appliedMappings: [] }),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({}))
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
vi.mock("@nodaro/shared/apps", async (importOriginal) => ({
  ...await importOriginal<typeof import("@nodaro/shared/apps")>(),
  mergeExposedSettings: vi.fn().mockReturnValue({ settings: {}, exposedSettingValues: {} }),
  applyHandleInputOverride: vi.fn().mockImplementation((_e, node) => node),
  isHandleInputWired: vi.fn().mockReturnValue(false),
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"
import { supabase } from "@/lib/supabase.js"
import { __resetSurfaceProfileCacheForTests } from "@/lib/surface-profile.js"

const OUTSIDE = "https://cdn.example/clip.mp4"
const OWN_STORAGE = "https://media.nodaro.test"
const OWN = `${OWN_STORAGE}/uploads/videos/clip.mp4`
const savedR2 = process.env.R2_PUBLIC_URL

function makeNode(): SimpleNode {
  return { id: "n1", type: "video-upscale", data: { provider: "topaz", targetResolution: "1080p", targetFps: 30 } }
}

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "manual",
    cancelled: false,
    isAppRun: false,
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

function linksOff(off: boolean): void {
  if (off) process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ imports: { links: false } })
  else delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
}

const deletedIds: string[] = []
const updatePatches: Array<Record<string, unknown>> = []

beforeEach(() => {
  vi.clearAllMocks()
  process.env.R2_PUBLIC_URL = OWN_STORAGE
  built.payload = { jobId: "test-job-id", provider: "topaz", videoUrl: OUTSIDE, targetResolution: "1080p", targetFps: 30 }
  deletedIds.length = 0
  updatePatches.length = 0
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50_000, watermark: false })
  // The reservation throws a sentinel so the allowed path stops cleanly before polling
  // (the executor reports it as a failed reservation).
  mockReserveCredits.mockRejectedValue(new Error("reservation-sentinel"))
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null })
  const mockInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockSingle }) })
  const mockUpdate = vi.fn((patch: Record<string, unknown>) => {
    updatePatches.push(patch)
    return { eq: vi.fn().mockResolvedValue({ error: null }) }
  })
  deleteThrows.value = false
  const mockDelete = vi.fn().mockReturnValue({
    eq: vi.fn((field: string, value: string) => {
      if (field === "id") deletedIds.push(value)
      return Promise.resolve({ error: null })
    }),
  })
  vi.mocked(supabase.from).mockReturnValue({
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    select: vi.fn(),
  } as unknown as ReturnType<typeof supabase.from>)
})

afterEach(() => {
  linksOff(false)
  if (savedR2 === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedR2
})

describe("node-executor: a Topaz video upscale and the link-import switch", () => {
  it("links off, a clip from another site: the node fails with link_imports_disabled, its placeholder row removed, nothing read, held or queued", async () => {
    linksOff(true)
    await expect(executeNode(makeNode(), {}, [], [], {}, makeCtx())).rejects.toMatchObject({ errorCode: "link_imports_disabled" })
    expect(deletedIds).toEqual(["test-job-id"])
    expect(mockProbe).not.toHaveBeenCalled()
    expect(updatePatches.some((p) => "input_data" in p)).toBe(false)
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it("links off, a clip on this deployment's own storage: measured and on to the reservation", async () => {
    linksOff(true)
    built.payload = { ...built.payload, videoUrl: OWN }
    // Past the stamp: the clip is measured, and the run reaches its reservation (stopped by the sentinel).
    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).catch((e: unknown) => e) as Error & { errorCode?: string }
    expect(err.message).toMatch(/reservation/i)
    expect(err.errorCode).not.toBe("link_imports_disabled")
    expect(mockProbe).toHaveBeenCalledTimes(1)
  })

  it("links on, a clip from another site: as before, measured and on to the reservation", async () => {
    const err = await executeNode(makeNode(), {}, [], [], {}, makeCtx()).catch((e: unknown) => e) as Error & { errorCode?: string }
    expect(err.message).toMatch(/reservation/i)
    expect(err.errorCode).not.toBe("link_imports_disabled")
    expect(mockProbe).toHaveBeenCalledWith(OUTSIDE)
  })
})
