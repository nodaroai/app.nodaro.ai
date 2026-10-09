/**
 * node-executor → payload-builder THREADING of the source image's size.
 *
 * The payload builder is synchronous, so for "auto" on a model without a native
 * auto `executeNode` reads the size of the image the build will send (the url
 * `autoAspectSourceImageUrl` names) and hands it down as
 * `PayloadBuildContext.sourceImage`. What the builder does with it is pinned in
 * `payload-builder-auto-aspect-source.test.ts`; this file pins that the size is
 * READ for the right url, ARRIVES at the build, and is never read when it would
 * not be used. The field is optional, so a dropped argument compiles clean and
 * would quietly put every such run back on the model's first listed ratio.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockJobInsert, mockBuildPayload, mockQueueAdd, mockProbe } = vi.hoisted(() => ({
  mockJobInsert: vi.fn().mockResolvedValue({ data: { id: "test-job-id" }, error: null }),
  mockBuildPayload: vi.fn(() => ({
    jobName: "image-to-image",
    queueName: "video-generation",
    modelIdentifier: "seedream-5-pro-i2i",
    payload: { jobId: "test-job-id" },
  })),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockProbe: vi.fn(async (_url: string): Promise<{ width: number; height: number } | undefined> => ({ width: 1920, height: 1080 })),
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
// The size reader is the seam: the real url selection (`source-image.ts`) runs.
vi.mock("@/lib/image-source-size.js", () => ({ probeImageDisplaySize: mockProbe }))

import { executeNode } from "../node-executor.js"
import type { SimpleNode, OrchestratorContext, ResolvedInputs } from "../types.js"

const SOURCE = "https://cdn.example.com/source.png"

const ctx = () => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  userId: "user-1",
  triggerType: "manual",
  cancelled: false,
  isAppRun: false,
  onJobCreated: vi.fn(),
}) as unknown as OrchestratorContext

/** Runs `node` up to its build and returns the build context it was handed. */
async function buildContextFor(node: SimpleNode, inputs: ResolvedInputs = { imageUrl: SOURCE }): Promise<{ sourceImage?: unknown }> {
  // The poll never resolves in this harness; the build is all we need.
  void executeNode(node, inputs, [], [node], {}, ctx()).catch(() => {})
  await vi.waitFor(() => expect(mockBuildPayload).toHaveBeenCalled())
  return (mockBuildPayload.mock.calls[0] as unknown as unknown[])[4] as { sourceImage?: unknown }
}

const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data: { prompt: "make it dusk", ...data } })

describe("node-executor reads the source image's size before the build", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProbe.mockImplementation(async () => ({ width: 1920, height: 1080 }))
  })

  it("reads the image the build will send, and hands the size to the build", async () => {
    const built = await buildContextFor(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto" }))
    expect(mockProbe).toHaveBeenCalledTimes(1)
    expect(mockProbe).toHaveBeenCalledWith(SOURCE)
    expect(built.sourceImage).toEqual({ width: 1920, height: 1080 })
  })

  it("does the same on both modify-image arms and on edit-image", async () => {
    for (const [type, provider] of [["modify-image", "seedream-5-pro-i2i"], ["modify-image", "nano-banana-edit"], ["edit-image", "nano-banana-edit"]] as const) {
      vi.clearAllMocks()
      const built = await buildContextFor(node(type, { provider, aspectRatio: "auto" }))
      expect(mockProbe, `${type} ${provider}`).toHaveBeenCalledWith(SOURCE)
      expect(built.sourceImage, `${type} ${provider}`).toEqual({ width: 1920, height: 1080 })
    }
  })

  it("reads a stored image when nothing is wired", async () => {
    await buildContextFor(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto", imageUrl: SOURCE }), {})
    expect(mockProbe).toHaveBeenCalledWith(SOURCE)
  })

  it("builds without a size when the image cannot be read", async () => {
    mockProbe.mockImplementation(async () => undefined)
    const built = await buildContextFor(node("image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "auto" }))
    expect(mockProbe).toHaveBeenCalledTimes(1)
    expect(built.sourceImage).toBeUndefined()
  })

  it("reads nothing when the size would not be used", async () => {
    const unused: Array<[string, Record<string, unknown>]> = [
      // A native auto, a concrete ratio, and a node with no source photo.
      ["image-to-image", { provider: "gpt-image-2-i2i", aspectRatio: "auto" }],
      ["image-to-image", { provider: "seedream-5-pro-i2i", aspectRatio: "16:9" }],
      ["generate-image", { provider: "seedream-5-pro", aspectRatio: "auto" }],
    ]
    for (const [type, data] of unused) {
      vi.clearAllMocks()
      const built = await buildContextFor(node(type, data))
      expect(mockProbe, `${type} ${JSON.stringify(data)}`).not.toHaveBeenCalled()
      expect(built.sourceImage).toBeUndefined()
    }
  })
})
