/**
 * The Settings input on the orchestrator's path: the Aspect Ratio / Duration /
 * Provider nodes wired into a Generate Video node reach the payload builder
 * as that node's own fields, fitted to the model — and a Provider naming a
 * model the node cannot run stops the node before any job row exists.
 *
 * The field-mapping resolver is REAL here (it carries the Settings routing);
 * supabase, BullMQ and the payload builder are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(() => ({
    jobName: "text-to-video",
    queueName: "video-generation",
    modelIdentifier: "veo3",
    payload: { jobId: "test-job-id" },
  })),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkCredits: vi.fn(), reserveCredits: vi.fn() },
}))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockQueueAdd } }))
vi.mock("@/lib/render-queue.js", () => ({ renderQueue: { add: mockQueueAdd } }))
vi.mock("@/workers/shared.js", () => ({ refundJobCredits: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../payload-builder.js", () => ({ buildPayload: mockBuildPayload }))
vi.mock("../output-extractor.js", () => ({ buildNodeOutputFromJobData: vi.fn(), getPrimaryOutput: vi.fn() }))

import { executeNode } from "../node-executor.js"
import type { SimpleEdge, SimpleNode, OrchestratorContext } from "../types.js"

const ctx = () => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

const video: SimpleNode = { id: "v", type: "generate-video", data: { label: "Video", prompt: "a lighthouse", provider: "seedance-2-fast", duration: 4, aspectRatio: "16:9" } }
const settings: SimpleNode[] = [
  { id: "ratio", type: "aspect-ratio", data: { label: "Aspect Ratio", ratio: "4:5" } },
  { id: "len", type: "duration", data: { label: "Duration", seconds: 60 } },
  { id: "veo", type: "provider", data: { label: "Provider", category: "video", provider: "veo3" } },
  { id: "img", type: "provider", data: { label: "Image model", category: "image", provider: "nano-banana" } },
]
const wire = (source: string): SimpleEdge => ({ id: `e-${source}`, source, target: "v", targetHandle: "settings" }) as SimpleEdge

const image: SimpleNode = { id: "i", type: "generate-image", data: { label: "Image", prompt: "a cat", provider: "nano-banana-pro", providers: ["nano-banana-pro", "seedream"], aspectRatio: "16:9" } }
const imageModel: SimpleNode = { id: "nb", type: "provider", data: { label: "Provider", category: "image", provider: "nano-banana" } }
const wireImage = (source: string): SimpleEdge => ({ id: `ei-${source}`, source, target: "i", targetHandle: "settings" }) as SimpleEdge

describe("node-executor — Settings input on Generate Image", () => {
  beforeEach(() => vi.clearAllMocks())

  it("builds the payload with the wired model as the node's one model", async () => {
    void executeNode(image, {}, [wireImage("nb"), wireImage("ratio")], [image, imageModel, ...settings], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    const [built] = mockBuildPayload.mock.calls[0] as unknown as [SimpleNode]
    expect(built.data).toMatchObject({ provider: "nano-banana", providers: ["nano-banana"] })
  })

  it("refuses a wired video model before any job row", async () => {
    await expect(executeNode(image, {}, [wireImage("veo")], [image, ...settings], {}, ctx())).rejects.toMatchObject({
      code: "settings_provider_not_accepted",
    })
    expect(mockBuildPayload).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
  })
})

describe("node-executor — Settings input", () => {
  beforeEach(() => vi.clearAllMocks())

  it("builds the payload with the wired values, fitted to the model", async () => {
    const edges = [wire("ratio"), wire("len"), wire("veo")]
    void executeNode(video, {}, edges, [video, ...settings], {}, ctx()).catch(() => {})
    await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
    const [built] = mockBuildPayload.mock.calls[0] as unknown as [SimpleNode]
    // 60 s → VEO 3.1's longest length (4/6/8); 4:5 → its nearest ratio.
    expect(built.data).toMatchObject({ provider: "veo3", duration: 8, aspectRatio: "9:16" })
  })

  it("refuses a Provider naming a model the node cannot run, before any job row", async () => {
    await expect(executeNode(video, {}, [wire("img")], [video, ...settings], {}, ctx())).rejects.toMatchObject({
      code: "settings_provider_not_accepted",
      message: expect.stringContaining("Image model"),
    })
    expect(mockBuildPayload).not.toHaveBeenCalled()
    expect(mockJobInsert).not.toHaveBeenCalled()
  })
})
