// The render worker and a container that is out of processes and threads
// (render-shortage.ts): what the worker does at a job's pickup, with the render
// call, and with a failure — on the real processor, around a watch the test
// controls.
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const rows = { record: null as Record<string, unknown> | null, claimed: [{ id: "job-1" }] as Array<{ id: string }> }
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    let isUpdate = false
    chain.select = vi.fn(() => (isUpdate ? Promise.resolve({ data: rows.claimed, error: null }) : chain))
    chain.update = vi.fn(() => { isUpdate = true; return chain })
    chain.eq = vi.fn(() => chain)
    chain.in = vi.fn(() => chain)
    chain.is = vi.fn(() => chain)
    chain.single = vi.fn(() => Promise.resolve({ data: rows.record, error: null }))
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))
    return chain
  })
  /** The watch the worker sees: the test sets what it answers. */
  const watch = {
    waitTurn: false,
    sawShortage: false,
    entered: 0,
    left: 0,
    started: vi.fn(),
    progress: vi.fn(),
  }
  return {
    rows, from, watch,
    processor: null as null | ((job: unknown, token?: string) => Promise<unknown>),
    createWorkDir: vi.fn(async () => "/tmp/render-shortage-test"),
    markJobFailed: vi.fn(async () => true),
    refund: vi.fn(async () => undefined),
    admit: vi.fn(),
    release: vi.fn(async () => undefined),
    sceneChild: vi.fn(async () => undefined),
    openBrowser: vi.fn(),
    renderMedia: vi.fn(),
  }
})

vi.mock("../render-shortage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../render-shortage.js")>()),
  renderWatch: () => ({
    mustWaitTurn: () => mocks.watch.waitTurn,
    enter: () => { mocks.watch.entered += 1 },
    leave: () => { mocks.watch.left += 1 },
    noteEncoderDeath: () => undefined,
    track: () => ({
      started: mocks.watch.started,
      progress: mocks.watch.progress,
      stuck: () => undefined,
      sawShortage: () => mocks.watch.sawShortage,
    }),
  }),
}))

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", REMOTION_CONCURRENCY: null, RENDER_WORKER_CONCURRENCY: 2 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("@/lib/storage.js", () => ({ uploadFileToR2: vi.fn(async () => "https://cdn.example.com/videos/job-1.mp4") }))
vi.mock("@/utils/watermark.js", () => ({ applyVideoWatermark: vi.fn() }))
vi.mock("@/lib/access-blocks.js", () => ({ isUserQuietStopped: vi.fn(async () => false), QUIET_STOP_RECHECK_MS: 600_000 }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailed: mocks.markJobFailed }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: vi.fn(async () => undefined),
  downloadFile: vi.fn(),
  runFfmpeg: vi.fn(),
  needsTranscode: vi.fn(),
  transcodeToBrowserSafe: vi.fn(),
  restoreVideoAudioFromSource: vi.fn(),
  BROWSER_SAFE_VIDEO_ARGS: [],
  REMOTION_INPUT_VIDEO_ARGS: [],
}))
vi.mock("../shared.js", () => ({
  commitJobCredits: vi.fn(async () => undefined),
  refundJobCredits: mocks.refund,
  shouldSaveJobResult: vi.fn(async () => true),
  generateAndUploadThumbnail: vi.fn(async () => "https://cdn.example.com/thumbnails/job-1.png"),
  createAssetFromJob: vi.fn(async () => undefined),
  markJobCompletedDetailed: vi.fn(async () => "completed"),
  // The queue's own rule, as workers/shared.ts states it.
  isFinalJobAttempt: (job: { attemptsMade: number; opts?: { attempts?: number } }) => job.attemptsMade + 1 >= (job.opts?.attempts ?? 1),
}))
vi.mock("../../lib/concurrency-lanes/worker-admit.js", () => ({
  admitOrPark: mocks.admit,
  pickupStatusesFor: () => ["pending", "queued", "processing"],
  WORKER_ROW_COLUMNS: "id",
  workerRowOf: () => ({}),
}))
vi.mock("../../lib/concurrency-lanes/hold.js", () => ({ runHolding: (_hold: unknown, work: () => Promise<unknown>) => work() }))
vi.mock("../../lib/concurrency-lanes/park.js", () => ({ registerLaneParking: vi.fn() }))
vi.mock("../../lib/concurrency-lanes/server-share.js", () => ({ serverShare: vi.fn() }))
vi.mock("../../lib/concurrency-lanes/columns.js", () => ({
  claimWithBullEntry: (_queue: string, _id: unknown, claim: (fields: Record<string, unknown>) => unknown) => claim({}),
  dropRequeuePayload: vi.fn(),
}))
vi.mock("../scene3d-render-child.js", () => ({ processSceneRenderChild: mocks.sceneChild }))
vi.mock("bullmq", () => {
  class Worker {
    constructor(_queue: string, processor: (job: unknown, token?: string) => Promise<unknown>) {
      mocks.processor = processor
    }
  }
  class DelayedError extends Error {}
  return { Worker, DelayedError }
})
vi.mock("ioredis", () => { class FakeRedis {}; return { default: FakeRedis } })
vi.mock("@remotion/bundler", () => ({ bundle: vi.fn(async () => "/tmp/bundle") }))
vi.mock("@remotion/renderer", () => ({
  openBrowser: mocks.openBrowser,
  selectComposition: vi.fn(async () => ({ id: "slideshow", width: 1080, height: 1920, fps: 30, durationInFrames: 90, props: {} })),
  renderMedia: mocks.renderMedia,
  makeCancelSignal: () => ({ cancelSignal: () => undefined, cancel: vi.fn() }),
}))
// createRenderWorker sweeps stale work dirs under the OS temp dir at boot:
// point it at a directory that does not exist.
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  tmpdir: () => "/nonexistent-render-shortage-test",
}))

import { DelayedError } from "bullmq"
import { createRenderWorker } from "../render-worker.js"
import { renderFfmpegArgs, RENDER_TAB_CAP } from "../render-concurrency.js"
import { RenderEncoderError, RenderShortageError, RENDER_ENCODER_MESSAGE, RENDER_SHORTAGE_MESSAGE, SHORTAGE_RETRY_BASE_MS, SHORTAGE_TURN_RECHECK_MS } from "../render-shortage.js"

const RAW_TIMEOUT = 'A delayRender() "Fetching http://localhost:3002/proxy?src=http%3A%2F%2F127.0.0.1%3A39245%2Fnorm-1.mp4&time=7.76 from server" was called but not cleared after 118000ms.'

const jobData = (over: Record<string, unknown> = {}) => ({
  jobId: "job-1", template: "slideshow", fps: 30, width: 1080, height: 1920, durationInFrames: 90, transitionStyle: "fade",
  transitionDurationFrames: 10, mediaAssets: [], textOverlays: [], captions: [], backgroundColor: "#000000", kenBurnsEnabled: false, ...over,
})

const renderJob = (over: Record<string, unknown> = {}) => ({
  id: "bull-1", name: "render-video", data: jobData(), attemptsMade: 0, opts: { attempts: 4 },
  updateProgress: vi.fn(async () => undefined), updateData: vi.fn(async () => undefined), moveToDelayed: vi.fn(async () => undefined), ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows.record = {
    usage_log_id: "usage-1", user_id: "U", status: "pending", started_at: null, parent_job_id: null, workflow_execution_id: null,
    pipeline_id: null, workspace_id: null, org_id: null, source: null, source_detail: null, mcp_client: null, force_private: false,
    should_watermark: false, profiles: { tier: "pro", public_outputs: true },
  }
  mocks.rows.claimed = [{ id: "job-1" }]
  Object.assign(mocks.watch, { waitTurn: false, sawShortage: false, entered: 0, left: 0 })
  mocks.admit.mockImplementation(async () => ({ hold: {}, release: mocks.release }))
  mocks.openBrowser.mockImplementation(async () => ({ close: vi.fn(async () => undefined) }))
  mocks.renderMedia.mockImplementation(async () => undefined)
  createRenderWorker()
})

describe("a render picked up after a shortage", () => {
  it("waits its turn: back to the queue for a few seconds, before anything is claimed", async () => {
    mocks.watch.waitTurn = true
    const job = renderJob()
    const before = Date.now()
    await expect(mocks.processor!(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "lock-token")
    const until = (job.moveToDelayed.mock.calls[0] as unknown as [number])[0]
    expect(until).toBeGreaterThanOrEqual(before + SHORTAGE_TURN_RECHECK_MS)
    expect(until).toBeLessThan(before + 60_000)
    // No concurrency slot, no work directory, no claim: the row stays as it was.
    expect(mocks.admit).not.toHaveBeenCalled()
    expect(mocks.createWorkDir).not.toHaveBeenCalled()
    expect(mocks.watch.entered).toBe(0)
  })

  it("a scene's child render never waits: the render that started it is waiting on it", async () => {
    mocks.watch.waitTurn = true
    const job = { id: "bull-c1", name: "scene-render-child", data: { jobId: "job-1", sceneRenderChild: true }, moveToDelayed: vi.fn() }
    await mocks.processor!(job, "lock-token")
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(mocks.sceneChild).toHaveBeenCalledTimes(1)
  })

  it("a render its concurrency slot does not admit is counted out again", async () => {
    mocks.admit.mockImplementationOnce(async () => null)
    await expect(mocks.processor!(renderJob(), "lock-token")).rejects.toBeInstanceOf(DelayedError)
    // Counted in at the check (so two pickups in one moment cannot both find nobody running), out when it does not run.
    expect([mocks.watch.entered, mocks.watch.left]).toEqual([1, 1])
    expect(mocks.createWorkDir).not.toHaveBeenCalled()
  })

  it("every render that runs is counted in, and out again however it ends", async () => {
    await mocks.processor!(renderJob(), "lock-token")
    expect([mocks.watch.entered, mocks.watch.left]).toEqual([1, 1])
    mocks.openBrowser.mockRejectedValueOnce(new Error("boom"))
    await expect(mocks.processor!(renderJob(), "lock-token")).rejects.toThrow("boom")
    expect([mocks.watch.entered, mocks.watch.left]).toEqual([2, 2])
  })
})

describe("the render call", () => {
  it("is told its tabs and its encoder's threads, and reports its frames to the watch", async () => {
    await mocks.processor!(renderJob(), "lock-token")
    expect(mocks.renderMedia).toHaveBeenCalledTimes(1)
    const options = mocks.renderMedia.mock.calls[0]![0] as {
      concurrency: number
      ffmpegOverride: unknown
      onStart: (data: { frameCount: number; parallelEncoding: boolean; resolvedConcurrency: number }) => void
      onProgress: (data: { progress: number; renderedFrames: number; encodedFrames: number }) => void
    }
    expect(options.ffmpegOverride).toBe(renderFfmpegArgs)
    expect(options.concurrency).toBeGreaterThanOrEqual(1)
    expect(options.concurrency).toBeLessThanOrEqual(RENDER_TAB_CAP)
    options.onStart({ frameCount: 90, parallelEncoding: true, resolvedConcurrency: 4 })
    expect(mocks.watch.started).toHaveBeenCalledWith({ frameCount: 90, parallelEncoding: true })
    options.onProgress({ progress: 0.5, renderedFrames: 45, encodedFrames: 30 })
    expect(mocks.watch.progress).toHaveBeenCalledWith({ renderedFrames: 45, encodedFrames: 30 })
  })
})

describe("a render that failed while the container was refusing processes", () => {
  it("is put back for at least a minute — not failed, not refunded, and not run again five seconds later", async () => {
    mocks.watch.sawShortage = true
    mocks.openBrowser.mockRejectedValueOnce(new Error(RAW_TIMEOUT))
    const job = renderJob()
    const before = Date.now()
    await expect(mocks.processor!(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)
    expect(job.updateData).toHaveBeenCalledWith({ ...jobData(), shortageRetries: 1 })
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "lock-token")
    expect((job.moveToDelayed.mock.calls[0] as unknown as [number])[0]).toBeGreaterThanOrEqual(before + SHORTAGE_RETRY_BASE_MS)
    expect(mocks.markJobFailed).not.toHaveBeenCalled()
    expect(mocks.refund).not.toHaveBeenCalled()
    // The slot goes back as requeued (the admission's release is the lanes test's subject).
    expect(mocks.release).toHaveBeenCalledWith("requeued")
  })

  it("a render the watch stopped takes the same path, and each time waits longer", async () => {
    mocks.openBrowser.mockRejectedValueOnce(new RenderShortageError("no progress for 25 s after the container refused a process or thread"))
    const job = renderJob({ data: jobData({ shortageRetries: 1 }) })
    const before = Date.now()
    await expect(mocks.processor!(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)
    expect(job.updateData).toHaveBeenCalledWith({ ...jobData(), shortageRetries: 2 })
    expect((job.moveToDelayed.mock.calls[0] as unknown as [number])[0]).toBeGreaterThanOrEqual(before + 2 * SHORTAGE_RETRY_BASE_MS)
  })

  it("on its last run fails with a sentence, never the renderer's text, and refunds", async () => {
    mocks.watch.sawShortage = true
    mocks.openBrowser.mockRejectedValueOnce(new Error(RAW_TIMEOUT))
    // Three runs were put back: this is the fourth of four, though the queue has counted no failed attempt.
    const job = renderJob({ data: jobData({ shortageRetries: 3 }) })
    await expect(mocks.processor!(job, "lock-token")).resolves.toBeUndefined()
    expect(mocks.markJobFailed).toHaveBeenCalledWith("job-1", { error_message: RENDER_SHORTAGE_MESSAGE })
    expect(RENDER_SHORTAGE_MESSAGE).not.toMatch(/localhost|127\.0\.0\.1|https?:/)
    expect(mocks.refund).toHaveBeenCalledWith("usage-1", "job-1", RENDER_SHORTAGE_MESSAGE)
    // The row is failed and refunded: it does not go back to the queue, and the queue is not left to run it again.
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith("failed")
  })

  it("on the queue's own final attempt the failure still reaches the queue", async () => {
    mocks.watch.sawShortage = true
    mocks.openBrowser.mockRejectedValueOnce(new Error(RAW_TIMEOUT))
    const job = renderJob({ attemptsMade: 3 })
    await expect(mocks.processor!(job, "lock-token")).rejects.toThrow(RAW_TIMEOUT)
    expect(mocks.markJobFailed).toHaveBeenCalledWith("job-1", { error_message: RENDER_SHORTAGE_MESSAGE })
    expect(mocks.refund).toHaveBeenCalledTimes(1)
  })
})

describe("a render stopped because its encoder quit, with nothing refused", () => {
  const DETAIL = "no progress for 25 s after the renderer reported that an encoder quit (665 frames drawn, 0 encoded of 939): [libx264] Error while opening encoder"

  it("is retried by the queue as any failure — not put back as a shortage", async () => {
    mocks.openBrowser.mockRejectedValueOnce(new RenderEncoderError(DETAIL))
    const job = renderJob()
    await expect(mocks.processor!(job, "lock-token")).rejects.toBeInstanceOf(RenderEncoderError)
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(job.updateData).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).not.toHaveBeenCalled()
  })

  it("on its final attempt fails as an encoder failure, never as a busy server", async () => {
    mocks.openBrowser.mockRejectedValueOnce(new RenderEncoderError(DETAIL))
    const job = renderJob({ attemptsMade: 3 })
    await expect(mocks.processor!(job, "lock-token")).rejects.toBeInstanceOf(RenderEncoderError)
    expect(mocks.markJobFailed).toHaveBeenCalledWith("job-1", { error_message: RENDER_ENCODER_MESSAGE })
    expect(RENDER_ENCODER_MESSAGE).not.toBe(RENDER_SHORTAGE_MESSAGE)
    expect(mocks.refund).toHaveBeenCalledWith("usage-1", "job-1", RENDER_ENCODER_MESSAGE)
  })
})

describe("a render that failed with nothing refused", () => {
  it("is retried by the queue exactly as before", async () => {
    mocks.openBrowser.mockRejectedValueOnce(new Error(RAW_TIMEOUT))
    const job = renderJob()
    await expect(mocks.processor!(job, "lock-token")).rejects.toThrow(RAW_TIMEOUT)
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(job.updateData).not.toHaveBeenCalled()
    expect(mocks.markJobFailed).not.toHaveBeenCalled()
    expect(mocks.refund).not.toHaveBeenCalled()
  })

  it("on its final attempt is failed with its own message, as before", async () => {
    mocks.openBrowser.mockRejectedValueOnce(new Error("Remote asset could not be loaded"))
    const job = renderJob({ attemptsMade: 3 })
    await expect(mocks.processor!(job, "lock-token")).rejects.toThrow("Remote asset could not be loaded")
    expect(mocks.markJobFailed).toHaveBeenCalledWith("job-1", { error_message: "Remote asset could not be loaded" })
    expect(mocks.refund).toHaveBeenCalledWith("usage-1", "job-1", "Remote asset could not be loaded")
  })

  it("an error that fails the same way on an idle box is never called a shortage", async () => {
    mocks.watch.sawShortage = true
    mocks.openBrowser.mockRejectedValueOnce(new Error("Composition slideshow not found in the bundle"))
    const job = renderJob()
    await expect(mocks.processor!(job, "lock-token")).resolves.toBeUndefined()
    expect(mocks.markJobFailed).toHaveBeenCalledWith("job-1", { error_message: "Composition slideshow not found in the bundle" })
    expect(job.moveToDelayed).not.toHaveBeenCalled()
  })
})
