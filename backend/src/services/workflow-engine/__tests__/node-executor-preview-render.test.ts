/**
 * An Apply EDL preview in a workflow run (A1b):
 *   - its job row is inserted `force_private` (F1: previews are private on
 *     every lane), a final's is not;
 *   - a fan-out iteration's ROW reaches the payload builder, which reads the
 *     plan clip's identity from it (`PayloadBuildContext.listRow`).
 * Every external dependency is stubbed so the test runs in pure Node.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockInsert, mockBuildPayload } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockBuildPayload: vi.fn(() => ({
    jobName: "apply-edl",
    queueName: "video-generation",
    modelIdentifier: "apply-edl",
    payload: { jobId: "test-job-id" },
  })),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      insert: (row: unknown) => {
        mockInsert(row)
        return { select: () => ({ single: async () => ({ data: { id: "test-job-id" }, error: null }) }) }
      },
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      select: vi.fn(),
    }),
  },
}))

vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn() }))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const ctx = () => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

const render = (quality: string): SimpleNode => ({ id: "r1", type: "apply-edl", data: { output: "video", quality } })

describe("a workflow run's Apply EDL preview", () => {
  beforeEach(() => vi.clearAllMocks())

  it("inserts a proxy render's job force_private, and a final's not", async () => {
    void executeNode(render("proxy"), {}, [], [render("proxy")], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    expect(mockInsert.mock.calls[0][0]).toMatchObject({ job_type: "apply-edl", force_private: true })

    vi.clearAllMocks()
    void executeNode(render("final"), {}, [], [render("final")], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    expect((mockInsert.mock.calls[0][0] as Record<string, unknown>).force_private).toBeUndefined()
  })

  it("hands the iteration's row to the payload builder", async () => {
    void executeNode(render("proxy"), {}, [], [render("proxy")], {}, ctx(), 2, 5).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    const buildCtx = (mockBuildPayload.mock.calls[0] as unknown[])[4] as { listRow?: number }
    expect(buildCtx.listRow).toBe(5)
  })
})
