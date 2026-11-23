// LTX 2.5 Fast audio-to-video in a workflow run (decided 2026-11-23): the
// executor measures the clip and stamps the run it prices, THEN the
// free-credit preflight judges that measured run, THEN the reservation holds
// it, THEN the job is queued. A refused clip leaves no preflight, no hold and
// no job. Harness: lip-sync-dag-dispatch.test.ts.
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
  getModelCreditBaseCost: vi.fn(async () => ({ creditCost: 242, isEnabled: true, tierRestriction: null })),
}))
const probes = vi.hoisted(() => ({
  audioSec: 10.1 as number,
  /** The decode reads the file only part-way (damaged, cut short). */
  damaged: false,
  /** What the payload builder built for the node. */
  built: undefined as undefined | { modelIdentifier: string; payload: Record<string, unknown> },
}))
vi.mock("@/lib/image-source-probe.js", () => ({
  probeImageSource: async () => ({ size: { width: 1024, height: 1536 }, sizeBytes: 2_000_000 }),
}))
// The audio is downloaded and its decoded length counted (decided 2026-11-12): both stood in.
vi.mock("@/providers/video/decoded-audio-length.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/providers/video/decoded-audio-length.js")>()
  return {
    ...orig,
    measureDecodedAudio: async () => {
      if (probes.damaged) throw new orig.AudioReadStoppedError("the file reports damage")
      return { overCap: false, samples: Math.round(probes.audioSec * 44_100), seconds: probes.audioSec }
    },
  }
})
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: async (_url: string, path: string) => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, Buffer.alloc(300_000))
  },
  probeMediaStreams: async () => ({ hasVideo: false, hasAudio: true }),
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
    jobName: "generate-video",
    queueName: "video-generation",
    ...(probes.built
      ? { modelIdentifier: probes.built.modelIdentifier, payload: { ...probes.built.payload } }
      : {
          // The payload builder's audio-to-video mark, on a node's own 6 s length.
          modelIdentifier: "ltx-2.5-fast:6s:720p",
          payload: { jobId: "test-job-id", provider: "ltx-2.5-fast", prompt: "she sings", duration: 6, resolution: "720p", fps: 24, referenceAudioUrls: ["https://cdn.test/song.mp3"], drivingAudioPending: true },
        }),
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
  probes.audioSec = 10.1
  probes.damaged = false
  probes.built = undefined
  mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 10 })
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 50_000, watermark: false })
  mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 424, watermark: false })
  // The enqueue is the last step under test: refusing it ends executeNode before the poll.
  mockQueueAdd.mockRejectedValue(new Error("enqueue-sentinel"))
})


const node: SimpleNode = { id: "n1", type: "generate-video", data: { provider: "ltx-2.5-fast", duration: 6, resolution: "720p" } }

describe("an LTX 2.5 Fast audio-to-video node in a workflow run (decided 2026-11-23)", () => {
  it("measures, THEN judges free credits and holds the measured run, THEN queues it", async () => {
    probes.audioSec = 7.2
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)
    // The free-credit preflight sees the measured row and the server's own audio-driven request.
    const check = mockCheckCredits.mock.calls[0]!
    expect(check[1]).toBe("ltx-2.5-fast:8s:720p")
    expect(JSON.stringify(check)).toContain('"audioDriven":true')
    // The hold is the measured row, never the node's 6 s.
    expect(mockReserveCredits.mock.calls[0]![2]).toBe("ltx-2.5-fast:8s:720p")
    expect(mockCheckCredits.mock.invocationCallOrder[0]!).toBeLessThan(mockReserveCredits.mock.invocationCallOrder[0]!)
    const [, payload] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload).toMatchObject({ audioToVideo: true, duration: 7.15, drivingAudioSec: 7.2, drivingAudioBilledSec: 8 })
    expect(payload.drivingAudioPending).toBeUndefined()
  })

  it("a clip it refuses leaves no preflight, no hold and no job", async () => {
    probes.audioSec = 1.2
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/at least 2.05 s/)
    expect(mockCheckCredits).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})
