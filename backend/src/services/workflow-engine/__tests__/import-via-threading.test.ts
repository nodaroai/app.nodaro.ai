// The way a run was started (`OrchestratorContext.importVia`) rides every
// worker-queued payload out of the orchestrator, so a handler that fetches a
// link (`importRightsOf`, workers/shared.ts) holds the fetch to the standing
// authorization a key's, an app's or an agent's run stands on. A run with no
// way in (a trigger's, a server's own relay) puts no key on the payload.
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
}))

vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: mockGetAppSettings }))

vi.mock("../payload-builder.js", () => ({
  buildPayload: vi.fn().mockReturnValue({
    jobName: "transcribe",
    queueName: "video-generation",
    modelIdentifier: "transcribe",
    payload: { jobId: "test-job-id", youtubeUrl: "https://youtu.be/abc" },
  }),
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

function makeCtx(importVia?: OrchestratorContext["importVia"]): OrchestratorContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    userId: "user-1",
    triggerType: "api",
    cancelled: false,
    isAppRun: false,
    billingContext: { payer: "user", userId: "user-1" },
    onJobCreated: vi.fn(),
    ...(importVia ? { importVia } : {}),
  } as unknown as OrchestratorContext
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAppSettings.mockResolvedValue({ cost_markup_percent: 0 })
  mockCheckCredits.mockResolvedValue({ allowed: true, balance: 5000, watermark: false })
  mockReserveCredits.mockResolvedValue({ usageLogId: "usage-1", creditsReserved: 3, watermark: false })
  // The enqueue is the last step under test: refusing it ends executeNode
  // before the poll, and the assertions are on what the queue RECEIVED.
  mockQueueAdd.mockRejectedValue(new Error("enqueue-sentinel"))
})

const node: SimpleNode = { id: "n1", type: "transcribe", data: { youtubeUrl: "https://youtu.be/abc" } }

describe("the way in rides every worker-queued payload", () => {
  it("an agent's run enqueues its nodes with importVia, so the handler's fetch stands on the standing authorization", async () => {
    await expect(executeNode(node, {}, [], [], {}, makeCtx("mcp"))).rejects.toThrow(/enqueue-sentinel/)
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    const [jobName, payload] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(jobName).toBe("transcribe")
    expect(payload).toMatchObject({ jobId: "test-job-id", usageLogId: "usage-1", importVia: "mcp" })
  })

  it("a run with no way in puts no key on the payload", async () => {
    await expect(executeNode(node, {}, [], [], {}, makeCtx())).rejects.toThrow(/enqueue-sentinel/)
    const [, payload] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload).not.toHaveProperty("importVia")
  })
})
