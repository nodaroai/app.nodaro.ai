/**
 * R14 on the orchestrator lane: Combine Videos with one resolved video outputs
 * it unchanged BEFORE the worker lane — no job row, no payload, no reservation.
 * Every external dependency is stubbed so the test runs in pure Node.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd, mockReserveCredits } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(() => ({
    jobName: "text-to-audio",
    queueName: "video-generation",
    modelIdentifier: "elevenlabs-sfx",
    payload: { jobId: "test-job-id" },
  })),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockReserveCredits: vi.fn().mockResolvedValue({ usageLogId: "u-1", creditsReserved: 1 }),
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
  CreditsService: { checkCredits: vi.fn(), reserveCredits: mockReserveCredits },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
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

describe("Combine Videos with one resolved video passes it through (R14)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("outputs the input unchanged with single_input, creates no job and reserves nothing", async () => {
    const node: SimpleNode = { id: "join", type: "combine-videos", data: { label: "Join", transition: "cut" } }
    const r = await executeNode(node, { videoUrls: ["https://cdn.example/a.mp4"] } as never, [], [node], {}, ctx())
    expect(r.output.videoUrl).toBe("https://cdn.example/a.mp4")
    expect(r.output.passThroughWarning).toBe("single_input")
    expect(r.jobId).toBeUndefined()
    expect(mockBuildPayload).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })
  it("two videos still take the worker lane", async () => {
    const node: SimpleNode = { id: "join", type: "combine-videos", data: { label: "Join", transition: "cut" } }
    void executeNode(node, { videoUrls: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"] } as never, [], [node], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
  })
})

describe("Video Overlay with an empty wired layer plan passes through (R14)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("outputs the input unchanged with no_layers, creates no job and reserves nothing", async () => {
    const node: SimpleNode = { id: "ov", type: "video-overlay", data: { label: "Overlay", layers: [] } }
    const r = await executeNode(node, { videoUrl: "https://cdn.example/v.mp4", layerPlan: "[]" } as never, [], [node], {}, ctx())
    expect(r.output.videoUrl).toBe("https://cdn.example/v.mp4")
    expect(r.output.passThroughWarning).toBe("no_layers")
    expect(r.jobId).toBeUndefined()
    expect(mockBuildPayload).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })
  it("a plan with a layer takes the worker lane", async () => {
    const node: SimpleNode = { id: "ov", type: "video-overlay", data: { label: "Overlay", layers: [] } }
    const plan = JSON.stringify([{ imageUrl: "https://cdn.example/s.png", start: 1 }])
    void executeNode(node, { videoUrl: "https://cdn.example/v.mp4", layerPlan: plan } as never, [], [node], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
  })
  it("an unreadable plan is not a pass-through (the payload builder's validator reports it)", async () => {
    const node: SimpleNode = { id: "ov", type: "video-overlay", data: { label: "Overlay", layers: [] } }
    void executeNode(node, { videoUrl: "https://cdn.example/v.mp4", layerPlan: "not json" } as never, [], [node], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
  })
})

describe("Add Captions with a wired caption plan that styles to nothing passes through (R14)", () => {
  beforeEach(() => vi.clearAllMocks())

  // The "nothing timed" plan: no hook line, no timed words.
  const empty = { v: 1, hookText: "", hookEndMs: 0, bodyEndMs: 0, captions: [] }
  const timed = { v: 1, hookText: "Sample hook", hookEndMs: 1400, bodyEndMs: 2400, captions: [{ text: "one", startMs: 1500, endMs: 1800 }] }

  it("outputs the input unchanged with no_captions, creates no job and reserves nothing", async () => {
    const node: SimpleNode = { id: "cap", type: "add-captions", data: { label: "Captions" } }
    const r = await executeNode(node, { videoUrl: "https://cdn.example/v.mp4", captionPlan: JSON.stringify(empty) } as never, [], [node], {}, ctx())
    expect(r.output.videoUrl).toBe("https://cdn.example/v.mp4")
    expect(r.output.passThroughWarning).toBe("no_captions")
    expect(r.jobId).toBeUndefined()
    expect(mockBuildPayload).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
    expect(mockReserveCredits).not.toHaveBeenCalled()
  })
  it("a plan with something to caption takes the worker lane", async () => {
    const node: SimpleNode = { id: "cap", type: "add-captions", data: { label: "Captions" } }
    void executeNode(node, { videoUrl: "https://cdn.example/v.mp4", captionPlan: JSON.stringify(timed) } as never, [], [node], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
  })
  it("an unparseable plan is not a pass-through (the payload builder throws it before the reservation)", async () => {
    const node: SimpleNode = { id: "cap", type: "add-captions", data: { label: "Captions" } }
    void executeNode(node, { videoUrl: "https://cdn.example/v.mp4", captionPlan: "not json" } as never, [], [node], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
  })
})
