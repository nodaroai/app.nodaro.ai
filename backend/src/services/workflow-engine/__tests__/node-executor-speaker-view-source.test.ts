/**
 * The dispatch gate is wired into `executeNode` (decided 2026-10-12, R5): a paid
 * node that feeds a video-fed Speaker View is refused BEFORE any job row or
 * reservation exists when the Speaker View's source now exists and is too
 * narrow — Transcribe never charges for a run that cannot succeed. The rule
 * itself is pinned in `speaker-view-source.test.ts`; this file pins that
 * `executeNode` asks it, for the node it is about to run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode runs only with both (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) =>
  (await import("../../../__tests__/helpers/speaker-view-video-gate-mock.js")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag),
)

const { mockJobInsert, mockBuildPayload, mockReserveCredits, mockMeasure } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(() => ({ jobName: "transcribe", queueName: "video-generation", modelIdentifier: "elevenlabs-stt", payload: { jobId: "test-job-id" } })),
  mockReserveCredits: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1 }),
  mockMeasure: vi.fn(async () => ({ durationMs: 5000, width: 1080, height: 1920 })),
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
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: mockJobInsert }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      select: vi.fn(),
    }),
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { checkCredits: vi.fn(), reserveCredits: mockReserveCredits } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: vi.fn().mockResolvedValue(undefined) } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("../output-extractor.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../output-extractor.js")>()),
  buildNodeOutputFromJobData: vi.fn(),
}))
vi.mock("../resolve-field-mappings.js", () => ({ resolveFieldMappings: (data: Record<string, unknown>) => data, NODE_MAPPABLE_FIELDS: {} }))
vi.mock("@/lib/availability-viewer.js", () => ({
  viewerForNode: vi.fn(async () => ({ admin: false })),
  assertNodeAvailableForUser: vi.fn(async () => undefined),
}))
vi.mock("@/lib/clip-measure.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/clip-measure.js")>()),
  measureClip: mockMeasure,
}))

import { executeNode } from "../node-executor.js"
import type { NodeExecutionState, OrchestratorContext, SimpleEdge, SimpleNode } from "../types.js"

const VIDEO = "https://cdn.example.test/generated/clip.mp4"
const nodes: SimpleNode[] = [
  { id: "gv", type: "generate-video", data: { label: "Generate Video" } },
  { id: "tx", type: "transcribe", data: { label: "Transcribe" } },
  { id: "sv", type: "speaker-view", data: { label: "Vertical cut" } },
]
const edges: SimpleEdge[] = [
  { id: "e1", source: "gv", target: "tx", sourceHandle: null, targetHandle: "audio" },
  { id: "e2", source: "gv", target: "sv", sourceHandle: null, targetHandle: "video" },
  { id: "e3", source: "tx", target: "sv", sourceHandle: "json", targetHandle: "transcript" },
]
const ctx = { executionId: "exec-1", workflowId: "wf-1", userId: "user-1", triggerType: "manual", cancelled: false, isAppRun: false, onJobCreated: vi.fn() } as unknown as OrchestratorContext
const states = (): Record<string, NodeExecutionState> => ({ gv: { status: "completed", output: { videoUrl: VIDEO } } as unknown as NodeExecutionState })

describe("executeNode asks the Speaker View source gate before it reserves anything", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flag.priced = true
    flag.frames = true
    mockMeasure.mockImplementation(async () => ({ durationMs: 5000, width: 1080, height: 1920 }))
  })

  it("refuses Transcribe for a too-narrow source, naming the Speaker View by its label, with nothing reserved or enqueued", async () => {
    const err = await executeNode(nodes[1]!, {}, edges, nodes, states(), ctx).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('Speaker View node "Vertical cut"')
    expect((err as Error).message).toMatch(/1080×1920/)
    expect(mockBuildPayload).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
  })

  it("F4: a run that does not include the Speaker View (ctx.speakerViewRunIds) does not refuse Transcribe or measure anything", async () => {
    void executeNode(nodes[1]!, {}, edges, nodes, states(), { ...ctx, speakerViewRunIds: new Set(["tx"]) } as OrchestratorContext).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    expect(mockMeasure).not.toHaveBeenCalled()
  })

  it("F4: a node inside a nested sub-workflow graph is gated whatever the top-level run set says", async () => {
    const err = await executeNode(nodes[1]!, {}, edges, nodes, states(), { ...ctx, speakerViewRunIds: new Set(["unrelated"]) } as OrchestratorContext, undefined, undefined, ["outer-sub"]).catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/1080×1920/)
  })

  it("lets Transcribe run for a wide source", async () => {
    mockMeasure.mockImplementation(async () => ({ durationMs: 5000, width: 3840, height: 2160 }))
    void executeNode(nodes[1]!, {}, edges, nodes, states(), ctx).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    expect(mockMeasure).toHaveBeenCalledTimes(1)
  })
})
