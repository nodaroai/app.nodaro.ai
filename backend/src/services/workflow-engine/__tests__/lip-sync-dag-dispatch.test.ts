// OmniHuman 2.0 in a workflow or app run (decided 2026-11-11): the run
// measures the audio before anything is held (`stampLipSyncInputs`), reserves
// the per-second row × the billed seconds, and queues the job WITH the held
// seconds — the worker refuses a 2.0 job without them (price and send the same
// bytes, providers/kie/lip-sync-audio.ts). A refused input leaves no
// reservation and no queued job. Harness: import-via-threading.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockCheckCredits, mockReserveCredits, mockGetAppSettings, mockQueueAdd } = vi.hoisted(() => ({
  mockCheckCredits: vi.fn(),
  mockReserveCredits: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockQueueAdd: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40) },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = vi.fn().mockReturnValue({ eq: eqFn })
  const deleteEqFn = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEqFn })
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
  getModelCreditBaseCost: vi.fn(async (id: string) => ({ creditCost: id === "omnihuman-2-0:per-second" ? 35 : 999, isEnabled: true, tierRestriction: null })),
}))
const probes = vi.hoisted(() => ({ audioSec: 10.04 }))
vi.mock("@/lib/image-source-probe.js", () => ({
  probeImageSource: async () => ({ size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }),
}))
// The audio is downloaded and its decoded length counted (decided 2026-11-12): both stood in.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (_url: string, path: string) => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, Buffer.alloc(300_000))
  },
}))
vi.mock("@/providers/video/decoded-audio-length.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/decoded-audio-length.js")>()),
  measureDecodedAudio: async () => ({ overCap: false, samples: Math.round(probes.audioSec * 44_100), seconds: probes.audioSec }),
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))
// A dub of a link reads the gate and measures the link before its job: both are this test's to pass.
vi.mock("@/lib/import-gate.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireImportAllowed: vi.fn(async () => undefined),
}))
vi.mock("@/lib/dubbing-pricing.js", () => ({
  stampDubbingDuration: vi.fn(async () => null),
  projectDubbingCreditOverride: vi.fn(async () => null),
}))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn(() => ({
    jobName: "lip-sync",
    queueName: "video-generation",
    modelIdentifier: "omnihuman-2-0:per-second",
    payload: { jobId: "test-job-id", provider: "omnihuman-2-0", imageUrl: "https://cdn.test/i.png", audioUrl: "https://cdn.test/a.mp3", prompt: "hi", audioDurationSec: 3 },
  })),
  buildNodeRefMap: vi.fn().mockReturnValue({}),
}))

vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: vi.fn().mockImplementation((node: unknown) => ({ node, appliedMappings: [] })),
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("../execution-graph.js", () => ({
  isSourceNode: vi.fn().mockReturnValue(false),
  isSkipNode: vi.fn().mockReturnValue(false),
}))
vi.mock("../inline-executor.js", () => ({}))
vi.mock("../sub-workflow-handler.js", () => ({ executeSubWorkflow: vi.fn() }))
vi.mock("../reference-sheet-stage-a.js", () => ({ ensureWorkflowSheetPanels: vi.fn() }))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

function makeCtx(): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "api",
    cancelled: false,
    isAppRun: false,
    billingContext: { payer: "user", userId: "user-1" },
    onJobCreated: vi.fn(),
  } as unknown as OrchestratorContext
}

beforeEach(() => {
  vi.clearAllMocks()
  probes.audioSec = 10.04
  mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 10 })
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50_000, watermark: false })
  mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 424, watermark: false })
  // The enqueue is the last step under test: refusing it ends executeNode before the poll.
  mockQueueAdd.mockRejectedValue(new Error("enqueue-sentinel"))
})

const node: SimpleNode = { id: "n1", type: "lip-sync", data: { provider: "omnihuman-2-0", audioDurationSec: 3 } }

describe("an OmniHuman 2.0 node in a workflow run", () => {
  it("holds the price of the audio it measured and queues the job with the held seconds", async () => {
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)
    // 10.04 s → 11 s × 35, marked up once (10 %) = 424 — never the node's stale 3 s.
    const [, , identifier, , , opts] = mockReserveCredits.mock.calls[0] as [string, string, string, number, number, { creditOverride?: number }]
    expect(identifier).toBe("omnihuman-2-0:per-second")
    expect(opts.creditOverride).toBe(424)
    const [jobName, payload] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(jobName).toBe("lip-sync")
    expect(payload).toMatchObject({ provider: "omnihuman-2-0", audioDurationSec: 10.04, lipSyncBilledSeconds: 11, usageLogId: "usage-1" })
  })

  it("audio past 300 s is refused before anything is held or queued", async () => {
    probes.audioSec = 301
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow()
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})
