/**
 * The workflow run QUEUES the units it measured for a Video Overlay with a
 * video layer: `stampVideoOverlayLength` writes `billedUnits` on the built
 * payload, and the payload the worker receives (`enrichedPayload` →
 * `queue.add`) must carry it — the worker refuses a video-layer job without it,
 * so a run is never charged below the base it renders. A refactor that enqueues a copy made before the stamp fails here,
 * rather than refusing every workflow run with a video layer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd, mockProbe } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockProbe: vi.fn(async (_url: string) => ({ streamDurationSec: 23 })),
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
// The base's probe is the seam: the real stamp (lib/video-overlay-length.ts) runs.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  probeVideoOverlayBaseSource: mockProbe,
}))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext } from "../types.js"

const BASE = "https://cdn.example.com/base.mp4"
const CLIP = "https://cdn.example.com/clip.mp4"

const ctx = () => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

const node: SimpleNode = { id: "vo", type: "video-overlay", data: {} }

/** The payload the run hands the queue for a build of `layers`. */
async function queuedFor(layers: Array<Record<string, unknown>>): Promise<Record<string, unknown>> {
  mockBuildPayload.mockImplementation(() => ({
    jobName: "video-overlay",
    queueName: "video-generation",
    modelIdentifier: "video-overlay",
    payload: { jobId: "test-job-id", videoUrl: BASE, layers },
  }))
  // The poll never resolves in this harness; the enqueue is all we need.
  void executeNode(node, { videoUrl: BASE }, [], [node], {}, ctx()).catch(() => {})
  await vi.waitFor(() => expect(mockQueueAdd).toHaveBeenCalled())
  const [jobName, payload] = mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>]
  expect(jobName).toBe("video-overlay")
  return payload
}

describe("the workflow run queues a Video Overlay's measured units", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProbe.mockImplementation(async () => ({ streamDurationSec: 23 }))
  })

  it("a node with a video layer: the queued payload carries the units its base measured (23 s → 5)", async () => {
    const payload = await queuedFor([{ videoUrl: CLIP, start: 0, anchor: "bottom-right", x: -4, y: -4, width: 18, fit: "contain", opacity: 1, animate: false }])
    expect(mockProbe).toHaveBeenCalledWith(BASE)
    expect(payload.billedUnits).toBe(5)
  })

  it("an image-only node: never measured, and queued with no units", async () => {
    const payload = await queuedFor([{ imageUrl: "https://cdn.example.com/card.png", start: 0, anchor: "bottom-right", x: -4, y: -4, width: 18, fit: "contain", opacity: 1, animate: true }])
    expect(mockProbe).not.toHaveBeenCalled()
    expect(payload).not.toHaveProperty("billedUnits")
  })
})
