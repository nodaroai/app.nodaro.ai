import type { Job } from "bullmq"
import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  read: vi.fn(), parent: vi.fn(), cancel: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn(),
  browserClose: vi.fn(), assetsClose: vi.fn(), cleanup: vi.fn(), open: vi.fn(), select: vi.fn(), media: vi.fn(), still: vi.fn(),
  upload: vi.fn(), watermark: vi.fn(), writePng: vi.fn(), existingPng: vi.fn(), cancellation: vi.fn(),
}))
vi.mock("../shared.js", () => ({ markJobCompletedDetailed: mocks.complete, isFinalJobAttempt: (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1) }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: mocks.fail }))
vi.mock("../../lib/private-plugins/scene3d-render-store.js", () => ({ createSceneRenderPorts: () => ({ read: mocks.read, parent: mocks.parent, cancel: mocks.cancel }) }))
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: () => {
  const q = { update: () => q, eq: () => q, in: () => q, select: mocks.claim }; return q
} } }))
vi.mock("../../lib/config.js", () => ({ config: { REMOTION_CONCURRENCY: 1 } }))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ createWorkDir: async () => "/tmp/render-test", cleanupWorkDir: mocks.cleanup }))
vi.mock("../../lib/storage.js", () => ({ uploadFileToR2: mocks.upload }))
vi.mock("../../utils/watermark.js", () => ({ applyVideoWatermark: mocks.watermark }))
vi.mock("node:fs/promises", () => ({ readFile: async () => Buffer.from("png") }))
vi.mock("../scene3d-child-assets.js", () => ({ prepareSceneChildAssets: async () => ({ assetUrls: { geometry: "http://127.0.0.1/owned" }, close: mocks.assetsClose }) }))
vi.mock("../../lib/private-plugins/scene3d-artifact-toolkit.js", () => ({ createScene3DArtifactToolkit: () => ({}) }))
vi.mock("../../lib/private-plugins/scene3d-write-json.js", () => ({ writeScene3DPng: mocks.writePng, receiveScene3DPngIfPresent: mocks.existingPng }))
vi.mock("../render-cancellation.js", () => ({ withRenderCancellation: mocks.cancellation }))
vi.mock("@remotion/renderer", () => ({ openBrowser: mocks.open, selectComposition: mocks.select, renderMedia: mocks.media,
  renderStill: mocks.still, makeCancelSignal: () => ({ cancel: vi.fn(), cancelSignal: {} }) }))
import { JobCancelledError } from "../../lib/job-cancellation.js"
import { DrainAbortError } from "../../lib/worker-drain.js"
import { processSceneRenderChild } from "../scene3d-render-child.js"

describe("scene render worker lifecycle", () => {
  const input = { parentJobId: "10000000-0000-4000-8000-000000000000", userId: "20000000-0000-4000-8000-000000000000",
    key: "render", plan: { schemaVersion: 1, revisionId: "30000000-0000-4000-8000-000000000000" },
    assets: "retained-revision", output: { kind: "video" } }
  let child: { id: string; status: string; userId: string; shouldWatermark: boolean; input: typeof input }
  let job: Job
  beforeEach(() => {
    vi.resetAllMocks()
    child = { id: "40000000-0000-4000-8000-000000000000", status: "pending", userId: input.userId, shouldWatermark: true, input: structuredClone(input) }
    job = { data: { jobId: child.id }, opts: { attempts: 4 }, attemptsMade: 0, updateProgress: vi.fn().mockResolvedValue(undefined) } as unknown as Job
    mocks.read.mockImplementation(async () => child)
    mocks.parent.mockResolvedValue({ userId: input.userId, status: "processing", stopRequested: false, reservationActive: true })
    mocks.claim.mockResolvedValue({ data: [{ id: child.id }], error: null })
    mocks.open.mockResolvedValue({ close: mocks.browserClose })
    mocks.select.mockResolvedValue({ id: "3d-scene" })
    mocks.upload.mockResolvedValue("https://cdn.example/video.mp4")
    mocks.complete.mockResolvedValue("completed")
    mocks.cancellation.mockImplementation(async (_options, work) => work())
    mocks.writePng.mockResolvedValue({ sha256: "a".repeat(64), byteLength: 123 })
    mocks.existingPng.mockResolvedValue(null)
  })
  it("uses the shared composition, watermarks with a cancellation signal and completes only after upload", async () => {
    await processSceneRenderChild(job, async () => "bundle", { gl: "angle" })
    expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ id: "3d-scene", serveUrl: "bundle", inputProps: {
      plan: child.input.plan, assetUrls: { geometry: "http://127.0.0.1/owned" } } }))
    expect(mocks.media).toHaveBeenCalledWith(expect.objectContaining({ codec: "h264", muted: true }))
    expect(mocks.watermark).toHaveBeenCalledWith(expect.any(String), expect.any(String), { signal: expect.any(AbortSignal) })
    expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]!)
    expect(mocks.complete).toHaveBeenCalledWith(child.id, expect.objectContaining({ is_public: false,
      output_data: { sceneRenderResult: expect.objectContaining({ kind: "video", sceneRevisionId: input.plan.revisionId }) } }))
    expect(mocks.browserClose).toHaveBeenCalled(); expect(mocks.assetsClose).toHaveBeenCalled(); expect(mocks.cleanup).toHaveBeenCalled()
  })
  it("renders critic frames as owned private PNG receipts without a public video upload", async () => {
    child.input.output = { kind: "stills", frames: [0, 48] } as unknown as typeof input.output
    await processSceneRenderChild(job, async () => "bundle", {})
    expect(mocks.still.mock.calls.map(([args]) => args.frame)).toEqual([0, 48])
    expect(mocks.writePng).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ jobId: input.parentJobId,
      userId: input.userId, revisionId: input.plan.revisionId, kind: "poster" }), { signal: expect.any(AbortSignal) })
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.media).not.toHaveBeenCalled()
    expect(mocks.complete).toHaveBeenCalledWith(child.id, expect.objectContaining({ output_data: { sceneRenderResult: expect.objectContaining({ kind: "stills", frames: expect.any(Array) }) } }))
  })
  it("adopts completed PNGs on retry instead of requiring another byte-identical render", async () => {
    child.input.output = { kind: "stills", frames: [0, 48] } as unknown as typeof input.output
    mocks.existingPng.mockResolvedValueOnce({ sha256: "b".repeat(64), byteLength: 456 })
    await processSceneRenderChild(job, async () => "bundle", {})
    expect(mocks.still.mock.calls.map(([args]) => args.frame)).toEqual([48])
    expect(mocks.complete).toHaveBeenCalledWith(child.id, expect.objectContaining({ output_data: {
      sceneRenderResult: expect.objectContaining({ frames: expect.arrayContaining([expect.objectContaining({ frame: 0, sha256: "b".repeat(64), byteLength: 456 })]) }),
    } }))
  })
  it("retries transient browser failures and terminalizes only the exhausted attempt", async () => {
    mocks.open.mockRejectedValue(new Error("Chromium connection reset"))
    await expect(processSceneRenderChild(job, async () => "bundle", {})).rejects.toThrow("connection reset")
    expect(mocks.fail).not.toHaveBeenCalled()
    job.attemptsMade = 3
    await expect(processSceneRenderChild(job, async () => "bundle", {})).rejects.toThrow("connection reset")
    expect(mocks.fail).toHaveBeenCalledOnce()
  })
  it("classifies a render timeout as failure even after its cancellation signal aborts", async () => {
    mocks.cancellation.mockImplementation(async (options) => { await options.cancel(); throw new Error("Render timed out") })
    await expect(processSceneRenderChild(job, async () => "bundle", {})).rejects.toThrow("timed out")
    expect(mocks.fail).toHaveBeenCalledWith(child.id, { error_message: "Scene render failed" })
    expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled()
  })
  it("cancels a user-stopped child without completing it", async () => {
    mocks.cancellation.mockRejectedValue(new JobCancelledError(child.id))
    await processSceneRenderChild(job, async () => "bundle", {})
    expect(mocks.cancel).toHaveBeenCalledWith(child)
    expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.fail).not.toHaveBeenCalled()
  })
  it("leaves a deployment interruption retryable until the bounded final attempt", async () => {
    mocks.cancellation.mockRejectedValue(new DrainAbortError())
    await expect(processSceneRenderChild(job, async () => "bundle", {})).rejects.toBeInstanceOf(DrainAbortError)
    expect(mocks.fail).not.toHaveBeenCalled()
    job.attemptsMade = 3
    await expect(processSceneRenderChild(job, async () => "bundle", {})).rejects.toBeInstanceOf(DrainAbortError)
    expect(mocks.fail).toHaveBeenCalledOnce()
  })
  it("refuses completion after the parent loses its reservation during upload", async () => {
    mocks.upload.mockImplementation(async () => {
      mocks.parent.mockResolvedValue({ userId: input.userId, status: "processing", reservationActive: false })
      return "https://cdn.example/video.mp4"
    })
    await processSceneRenderChild(job, async () => "bundle", {})
    expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(mocks.fail).not.toHaveBeenCalled()
  })
  it("does not report completion when the final database write was lost", async () => {
    mocks.complete.mockResolvedValue("lost_race")
    await expect(processSceneRenderChild(job, async () => "bundle", {})).rejects.toThrow("not retained")
    expect(job.updateProgress).not.toHaveBeenCalledWith(100)
    expect(mocks.fail).not.toHaveBeenCalled()
  })
})
