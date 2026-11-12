/**
 * The workflow run QUEUES the units it measured for a Mask Composite:
 * `stampMaskCompositeLength` writes `billedUnits` on the built payload, and the
 * payload the worker receives (`enrichedPayload` → `queue.add`) must carry it —
 * the render refuses a job without it, so a run is never charged below the
 * leading video it renders. A refactor that enqueues a copy made before the
 * stamp fails here, rather than refusing every workflow run of the node.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd, mockProbe } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockProbe: vi.fn(async (_url: string) => ({ width: 640, height: 360, durationSeconds: 23 })),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", PORT: 8000 },
  hasCredits: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/supabase.js", () => {
  const eqFn = vi.fn().mockResolvedValue({ error: null })
  return {
    supabase: {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockJobInsert }) }),
        update: vi.fn().mockReturnValue({ eq: eqFn }),
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        select: vi.fn(),
      }),
    },
  }
})

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn(), savedOutputFor: vi.fn() }))
vi.mock("../resolve-field-mappings.js", () => ({
  resolveFieldMappings: (data: Record<string, unknown>) => data,
  NODE_MAPPABLE_FIELDS: {},
}))
vi.mock("@/lib/availability-viewer.js", () => ({
  viewerForNode: async () => ({ admin: false }),
  assertNodeAvailableForUser: async () => {},
}))
// The leading video's probe is the seam: the real stamp (lib/mask-composite-length.ts) runs.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  probeVideoSource: mockProbe,
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const FG = "https://cdn.example.com/fg.mp4"
const BG = "https://cdn.example.com/bg.mp4"
const MASK = "https://cdn.example.com/mask.mp4"

const ctx = () => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

const node: SimpleNode = { id: "mc", type: "mask-composite", data: {} }

/** The payload the run hands the queue for a build of `payload`. */
async function queuedFor(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  mockBuildPayload.mockImplementation(() => ({
    jobName: "mask-composite",
    queueName: "video-generation",
    modelIdentifier: "mask-composite",
    payload: { jobId: "test-job-id", ...payload },
  }))
  // The poll never resolves in this harness; the enqueue is all we need.
  void executeNode(node, {}, [], [node], {}, ctx()).catch(() => {})
  await vi.waitFor(() => expect(mockQueueAdd).toHaveBeenCalled())
  const [jobName, queued] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
  expect(jobName).toBe("mask-composite")
  return queued
}

describe("the workflow run queues a Mask Composite's measured units", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProbe.mockImplementation(async (url: string) => ({ width: 640, height: 360, durationSeconds: url === BG ? 41 : 23 }))
  })

  it("the video fill: the queued payload carries the units its foreground measured (23 s → 5)", async () => {
    const queued = await queuedFor({ foregroundUrl: FG, backgroundUrl: BG, maskUrl: MASK, fill: "video" })
    expect(mockProbe).toHaveBeenCalledWith(FG)
    expect(queued.billedUnits).toBe(5)
  })

  it("pixelate: the units its background measured (41 s → 9), never the foreground's", async () => {
    const queued = await queuedFor({ foregroundUrl: FG, backgroundUrl: BG, maskUrl: MASK, fill: "pixelate" })
    expect(mockProbe).toHaveBeenCalledWith(BG)
    expect(mockProbe).not.toHaveBeenCalledWith(FG)
    expect(queued.billedUnits).toBe(9)
  })

  it("a billedUnits the built payload already carried (written into the node) is replaced by the measured one", async () => {
    const queued = await queuedFor({ foregroundUrl: FG, backgroundUrl: BG, maskUrl: MASK, billedUnits: 1 })
    expect(queued.billedUnits).toBe(5)
  })
})
