import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { videoAnalysisResultSchema, type WindowAnalysis } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Mock setup — mirrors handlers/__tests__/motion-graphics-lottie.test.ts:
//   * hoisted mock fns for every I/O seam (LLM, ffmpeg, yt, R2/storage, state,
//     segment, reconcile heartbeat, cancellation, sleep) + the worker-shared
//     lifecycle helpers (markJobCompleted / commitJobCredits / refundJobCredits).
//   * REAL merge (video-analysis-merge.js) + REAL @nodaro/shared schemas +
//     REAL settled-or-throw.js run — so the merge → schema-parse pipeline and
//     the bounded-concurrency fail-fast are exercised end-to-end.
//   * `sleep` is mocked to resolve immediately so the transport backoff never
//     inflates test wall-clock.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  llmCompleteStructured: vi.fn(),
  buildVideoAnalysisSystemPrompt: vi.fn(() => "VA_SYSTEM"),
  buildVideoAnalysisUserText: vi.fn((o: { windowLenSec: number; focus?: string }) => `len=${o.windowLenSec}`),
  markProviderCallStart: vi.fn().mockResolvedValue(undefined),
  throwIfJobCancelled: vi.fn().mockResolvedValue(undefined),
  sleep: vi.fn().mockResolvedValue(undefined),
  // ffmpeg-utils
  createWorkDir: vi.fn().mockResolvedValue("/w"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  probeVideoSource: vi.fn().mockResolvedValue({ width: 1280, height: 720, durationSeconds: 90 }),
  needsTranscode: vi.fn().mockResolvedValue(false),
  transcodeToBrowserSafe: vi.fn(async (i: string) => i),
  needsContainerRemux: vi.fn().mockReturnValue(false),
  remuxToMp4: vi.fn().mockResolvedValue(undefined),
  // youtube-video
  downloadYouTubeVideo: vi.fn().mockResolvedValue(undefined),
  // storage
  uploadFileWithKeyToR2: vi.fn().mockResolvedValue("https://cdn.example.com/uploaded"),
  r2Url: vi.fn((key: string) => `https://cdn.example.com/${key}`),
  getR2ObjectSize: vi.fn().mockResolvedValue(1000),
  downloadR2ObjectToFile: vi.fn().mockResolvedValue(undefined),
  // state
  vaTmpKeys: vi.fn((jobId: string) => ({
    prefix: `va/${jobId}/`,
    source: `va/${jobId}/source.mp4`,
    window: (k: number) => `va/${jobId}/window-${k}.mp4`,
    state: `va/${jobId}/state.json`,
  })),
  readVaState: vi.fn().mockResolvedValue(null),
  writeVaState: vi.fn().mockResolvedValue(undefined),
  deleteVaTmp: vi.fn().mockResolvedValue(undefined),
  // segment
  segmentAndUploadWindows: vi.fn(),
  recutWindowFromSource: vi.fn().mockResolvedValue(undefined),
  // worker-shared lifecycle
  markJobCompleted: vi.fn().mockResolvedValue(true),
  commitJobCredits: vi.fn().mockResolvedValue(undefined),
  refundJobCredits: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../lib/llm-client.js", () => ({ llmCompleteStructured: mocks.llmCompleteStructured }))
vi.mock("../../../lib/video-analysis-prompt.js", () => ({
  buildVideoAnalysisSystemPrompt: mocks.buildVideoAnalysisSystemPrompt,
  buildVideoAnalysisUserText: mocks.buildVideoAnalysisUserText,
}))
vi.mock("../../../lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("../../../lib/job-cancellation.js", () => ({ throwIfJobCancelled: mocks.throwIfJobCancelled }))
vi.mock("../../../lib/sleep.js", () => ({ sleep: mocks.sleep }))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
  downloadFile: mocks.downloadFile,
  probeVideoSource: mocks.probeVideoSource,
  needsTranscode: mocks.needsTranscode,
  transcodeToBrowserSafe: mocks.transcodeToBrowserSafe,
  needsContainerRemux: mocks.needsContainerRemux,
  remuxToMp4: mocks.remuxToMp4,
}))
vi.mock("../../../providers/video/youtube-video.js", () => ({ downloadYouTubeVideo: mocks.downloadYouTubeVideo }))
vi.mock("../../../lib/storage.js", () => ({
  uploadFileWithKeyToR2: mocks.uploadFileWithKeyToR2,
  r2Url: mocks.r2Url,
  getR2ObjectSize: mocks.getR2ObjectSize,
  downloadR2ObjectToFile: mocks.downloadR2ObjectToFile,
}))
vi.mock("../video-analysis-state.js", () => ({
  vaTmpKeys: mocks.vaTmpKeys,
  readVaState: mocks.readVaState,
  writeVaState: mocks.writeVaState,
  deleteVaTmp: mocks.deleteVaTmp,
}))
vi.mock("../video-analysis-segment.js", () => ({
  segmentAndUploadWindows: mocks.segmentAndUploadWindows,
  recutWindowFromSource: mocks.recutWindowFromSource,
}))
vi.mock("../../shared.js", () => ({
  markJobCompleted: mocks.markJobCompleted,
  commitJobCredits: mocks.commitJobCredits,
  refundJobCredits: mocks.refundJobCredits,
}))

import { handleVideoAnalysis, videoAnalysisHandlers } from "../video-analysis.js"

// --- fixtures ---------------------------------------------------------------

function validWindow(sceneStart = 0, sceneEnd = 5, mode: "silence" | "speech" = "silence"): WindowAnalysis {
  return {
    language: "en",
    slots: [],
    scenes: [
      {
        startSec: sceneStart,
        endSec: sceneEnd,
        label: "Scene",
        shotType: "wide",
        camera: "static",
        visual: "A wide shot of a quiet street.",
        audio: { mode, content: mode === "speech" ? "hello there" : "" },
      },
    ],
  }
}

const emptyWindow: WindowAnalysis = { language: "en", slots: [], scenes: [] }

function win(k: number, startSec: number, endSec: number, r2Key: string) {
  return { k, startSec, endSec, r2Key }
}

function makeJob(over: Record<string, unknown> = {}) {
  return {
    name: "video-analysis",
    id: "bull-1",
    data: {
      jobId: "job-1",
      usageLogId: "usage-1",
      videoUrl: "https://cdn.example.com/clip.mp4",
      llmModel: "gemini-3-flash",
      reservedCreditId: "video-analysis:gemini-3-flash:180s",
      ...over,
    },
    updateProgress: vi.fn(),
  }
}

const run = (over?: Record<string, unknown>) => handleVideoAnalysis(makeJob(over) as never)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buildVideoAnalysisSystemPrompt.mockReturnValue("VA_SYSTEM")
  mocks.buildVideoAnalysisUserText.mockImplementation((o: { windowLenSec: number }) => `len=${o.windowLenSec}`)
  mocks.throwIfJobCancelled.mockResolvedValue(undefined)
  mocks.sleep.mockResolvedValue(undefined)
  mocks.createWorkDir.mockResolvedValue("/w")
  mocks.probeVideoSource.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 90 })
  mocks.needsTranscode.mockResolvedValue(false)
  mocks.needsContainerRemux.mockReturnValue(false)
  mocks.transcodeToBrowserSafe.mockImplementation(async (i: string) => i)
  mocks.r2Url.mockImplementation((key: string) => `https://cdn.example.com/${key}`)
  mocks.getR2ObjectSize.mockResolvedValue(1000)
  mocks.readVaState.mockResolvedValue(null)
  mocks.writeVaState.mockResolvedValue(undefined)
  mocks.deleteVaTmp.mockResolvedValue(undefined)
  mocks.segmentAndUploadWindows.mockResolvedValue([win(0, 0, 90, "va/job-1/window-0.mp4")])
  mocks.markJobCompleted.mockResolvedValue(true)
  mocks.llmCompleteStructured.mockResolvedValue({ output: validWindow(), inputTokens: 100, outputTokens: 40, providerCost: 0.03 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("handleVideoAnalysis", () => {
  it("registers under the video-analysis job name", () => {
    expect(videoAnalysisHandlers["video-analysis"]).toBe(handleVideoAnalysis)
  })

  // 1 — single-window happy path
  it("single window: one LLM call, schema-valid output_data.json, summed provider_cost, non-metered commit, deleteVaTmp in finally", async () => {
    mocks.llmCompleteStructured.mockResolvedValue({ output: validWindow(), providerCost: 0.03 })

    await run()

    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
    // Isolated call site shape: video + text block, 300s timeout, maxRetries:1.
    const [req, schema, opts] = mocks.llmCompleteStructured.mock.calls[0]
    expect(req.timeoutMs).toBe(300_000)
    expect(req.messages[0].content[0]).toEqual({ type: "video", url: "https://cdn.example.com/va/job-1/window-0.mp4" })
    expect(schema).toBeDefined()
    expect(opts).toEqual({ maxRetries: 1 })

    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    const [jobId, patch] = mocks.markJobCompleted.mock.calls[0]
    expect(jobId).toBe("job-1")
    expect(patch.provider_cost).toBeCloseTo(0.03, 10)
    // The persisted output_data.json round-trips the merged result schema.
    expect(videoAnalysisResultSchema.safeParse(patch.output_data.json).success).toBe(true)
    expect(patch.output_data.json.meta.aspectRatio).toBe("16:9")
    expect(patch.output_data.json.meta.durationSec).toBe(90)

    // Non-metered commit: EXACTLY (usageLogId, jobId) — no provider-cost / metered arg.
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
    expect(mocks.refundJobCredits).not.toHaveBeenCalled()
    expect(mocks.deleteVaTmp).toHaveBeenCalledWith("job-1", 1)
  })

  // 2 — tolerance re-check
  it("tolerance: 60.4s passes the :60s bucket (+3 grace)", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 60.4 })
    mocks.segmentAndUploadWindows.mockResolvedValue([win(0, 0, 60.4, "va/job-1/window-0.mp4")])

    await run({ reservedCreditId: "video-analysis:gemini-3-flash:60s" })

    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
    expect(mocks.refundJobCredits).not.toHaveBeenCalled()
  })

  it("tolerance: 64s exceeds the :60s bucket → throws, handler does NOT refund, no segmentation, no LLM", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 64 })

    await expect(run({ reservedCreditId: "video-analysis:gemini-3-flash:60s" })).rejects.toMatchObject({
      code: "duration_exceeded_reserved_bucket",
    })

    expect(mocks.segmentAndUploadWindows).not.toHaveBeenCalled()
    expect(mocks.llmCompleteStructured).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    // Invariant pin: the handler must NEVER refund directly. On the orchestrated
    // path (queue default attempts: 3) a non-final-attempt refund + a successful
    // retry's commit no-op would deliver the analysis FREE — worker owns the
    // final-attempt refund.
    expect(mocks.refundJobCredits).not.toHaveBeenCalled()
    expect(mocks.deleteVaTmp).toHaveBeenCalledWith("job-1", 0)
  })

  // 3 — cap re-check
  it("cap: 604s exceeds the 600s ceiling (+3) → throws, handler does NOT refund, no LLM", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 604 })

    await expect(run({ reservedCreditId: "video-analysis:gemini-3-flash:600s" })).rejects.toMatchObject({
      code: "video_too_long",
    })

    expect(mocks.llmCompleteStructured).not.toHaveBeenCalled()
    // Invariant pin: handler never refunds directly (worker owns final-attempt
    // refund) — guards the non-final-attempt refund + successful-retry commit no-op.
    expect(mocks.refundJobCredits).not.toHaveBeenCalled()
  })

  it("cap: 600.8s passes the :600s ceiling within tolerance", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 600.8 })
    mocks.segmentAndUploadWindows.mockResolvedValue([win(0, 0, 600.8, "va/job-1/window-0.mp4")])

    await run({ reservedCreditId: "video-analysis:gemini-3-flash:600s" })

    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  // 3b — worker SSRF gate: narrow YouTube allowlist re-validation (spec D2). The
  // worker is the only choke point on the orchestrated path (no route preHandler);
  // a non-YouTube host must be rejected BEFORE yt-dlp is spawned.
  it("youtube allowlist: a non-YouTube host (orchestrated payload) fails with youtube_host_not_allowed, no download", async () => {
    await expect(
      run({ videoUrl: undefined, youtubeUrl: "https://tiktok.com/@x/video/1" }),
    ).rejects.toThrow(/youtube_host_not_allowed/)

    // yt-dlp is never spawned — the narrow YOUTUBE_HOSTS check rejects the host first.
    expect(mocks.downloadYouTubeVideo).not.toHaveBeenCalled()
    expect(mocks.segmentAndUploadWindows).not.toHaveBeenCalled()
    expect(mocks.llmCompleteStructured).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    // Invariant pin: the handler never refunds directly (worker owns final-attempt refund).
    expect(mocks.refundJobCredits).not.toHaveBeenCalled()
    expect(mocks.deleteVaTmp).toHaveBeenCalledWith("job-1", 0)
  })

  it("youtube allowlist: a valid youtu.be host (orchestrated payload) passes the gate and downloads", async () => {
    await run({ videoUrl: undefined, youtubeUrl: "https://youtu.be/abc123" })

    expect(mocks.downloadYouTubeVideo).toHaveBeenCalledTimes(1)
    expect(mocks.downloadYouTubeVideo.mock.calls[0][0].url).toBe("https://youtu.be/abc123")
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
  })

  // 4 — transport budget exhaustion → all-or-nothing refund
  it("transport budget: persistent 429 across windows → all-or-nothing throw, handler does NOT refund, no commit", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 600 })
    mocks.segmentAndUploadWindows.mockResolvedValue([
      win(0, 0, 155, "va/job-1/window-0.mp4"),
      win(1, 145, 300, "va/job-1/window-1.mp4"),
      win(2, 290, 445, "va/job-1/window-2.mp4"),
      win(3, 435, 590, "va/job-1/window-3.mp4"),
      win(4, 580, 600, "va/job-1/window-4.mp4"),
    ])
    mocks.llmCompleteStructured.mockRejectedValue(
      new Error("KIE.ai chat-completions gemini-3-flash failed (429): rate limited"),
    )

    await expect(run({ reservedCreditId: "video-analysis:gemini-3-flash:600s" })).rejects.toThrow(/429/)

    // First attempts + the 3 shared retries were spent, then the job failed.
    expect(mocks.llmCompleteStructured.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
    // Invariant pin: handler never refunds directly (worker owns final-attempt
    // refund) — guards the non-final-attempt refund + successful-retry commit no-op.
    expect(mocks.refundJobCredits).not.toHaveBeenCalled()
    expect(mocks.deleteVaTmp).toHaveBeenCalledWith("job-1", 5)
  })

  // 5 — zero-scene window is valid
  it("zero-scene window: a window returning no scenes still yields a completed job", async () => {
    mocks.probeVideoSource.mockResolvedValue({ width: 1280, height: 720, durationSeconds: 200 })
    mocks.segmentAndUploadWindows.mockResolvedValue([
      win(0, 0, 155, "va/job-1/window-0.mp4"),
      win(1, 145, 200, "va/job-1/window-1.mp4"),
    ])
    mocks.llmCompleteStructured.mockImplementation(async (req: { messages: { content: { url?: string }[] }[] }) => {
      const url = req.messages[0].content[0].url ?? ""
      return url.includes("window-0")
        ? { output: emptyWindow, providerCost: 0.01 }
        : { output: validWindow(0, 6), providerCost: 0.02 }
    })

    await run({ reservedCreditId: "video-analysis:gemini-3-flash:360s" })

    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    const patch = mocks.markJobCompleted.mock.calls[0][1]
    expect(videoAnalysisResultSchema.safeParse(patch.output_data.json).success).toBe(true)
    expect(patch.output_data.json.scenes.length).toBeGreaterThanOrEqual(1)
    expect(patch.provider_cost).toBeCloseTo(0.03, 10)
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  // 6 — full re-entry
  it("re-entry (full): all results present → merge only, no download/segment/LLM", async () => {
    mocks.readVaState.mockResolvedValue({
      meta: { durationSec: 90, width: 1280, height: 720, title: "Cached Title" },
      windows: [win(0, 0, 90, "va/job-1/window-0.mp4")],
      results: { 0: validWindow() },
    })

    await run()

    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.downloadYouTubeVideo).not.toHaveBeenCalled()
    expect(mocks.createWorkDir).not.toHaveBeenCalled()
    expect(mocks.segmentAndUploadWindows).not.toHaveBeenCalled()
    expect(mocks.llmCompleteStructured).not.toHaveBeenCalled()

    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    expect(mocks.markJobCompleted.mock.calls[0][1].output_data.json.meta.title).toBe("Cached Title")
    expect(mocks.commitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  // 7 — partial re-entry
  it("re-entry (partial): only the missing window is analyzed, with its STORED boundaries", async () => {
    mocks.readVaState.mockResolvedValue({
      meta: { durationSec: 400, width: 1920, height: 1080 },
      windows: [win(0, 0, 150, "k0"), win(1, 145, 295, "k1"), win(2, 290, 400, "k2")],
      results: { 0: validWindow(), 2: validWindow(0, 4) },
    })

    await run({ reservedCreditId: "video-analysis:gemini-3-flash:600s" })

    // Exactly one LLM call — window 1 — with its stored 150s length + stored clip URL.
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
    const req = mocks.llmCompleteStructured.mock.calls[0][0]
    expect(req.messages[0].content[0]).toEqual({ type: "video", url: "https://cdn.example.com/k1" })
    expect(req.messages[0].content[1].text).toBe("len=150")

    // Stored clips reused: no fresh segmentation, no re-download, no re-cut.
    expect(mocks.segmentAndUploadWindows).not.toHaveBeenCalled()
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.recutWindowFromSource).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
  })

  it("re-entry (partial): a swept window clip is re-materialized + re-cut before analysis", async () => {
    mocks.readVaState.mockResolvedValue({
      meta: { durationSec: 400, width: 1920, height: 1080 },
      windows: [win(0, 0, 150, "k0"), win(1, 145, 295, "k1"), win(2, 290, 400, "k2")],
      results: { 0: validWindow(), 2: validWindow(0, 4) },
    })
    mocks.getR2ObjectSize.mockResolvedValue(0) // window-1 clip swept

    await run({ reservedCreditId: "video-analysis:gemini-3-flash:600s" })

    expect(mocks.downloadR2ObjectToFile).toHaveBeenCalled() // re-materialized from tmp.source
    expect(mocks.recutWindowFromSource).toHaveBeenCalledTimes(1)
    expect(mocks.recutWindowFromSource.mock.calls[0][0].window.k).toBe(1)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
  })

  // 8 — heartbeat ticks + clearInterval
  it("heartbeat: re-stamps pre-task during a long window and clearInterval leaves no dangling timer", async () => {
    vi.useFakeTimers()
    mocks.segmentAndUploadWindows.mockResolvedValue([win(0, 0, 90, "va/job-1/window-0.mp4")])
    let resolveLlm!: () => void
    mocks.llmCompleteStructured.mockReturnValue(
      new Promise((res) => {
        resolveLlm = () => res({ output: validWindow(), providerCost: 0.03 })
      }),
    )

    const promise = run()
    // Let ingest + segmentation settle, then fire the 60s heartbeat.
    await vi.advanceTimersByTimeAsync(60_000 + 10)
    expect(mocks.markProviderCallStart).toHaveBeenCalledWith("job-1", "pre-task")

    resolveLlm()
    await vi.advanceTimersByTimeAsync(0)
    await promise

    expect(mocks.markJobCompleted).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0) // clearInterval ran in finally
  })

  // 9 — cancellation mid-run → refund + cleanup
  it("cancellation: throwIfJobCancelled mid-run → propagates, handler does NOT refund, deleteVaTmp still runs, no LLM", async () => {
    let calls = 0
    mocks.throwIfJobCancelled.mockImplementation(async () => {
      calls += 1
      if (calls >= 2) throw new Error("Job job-1 was cancelled")
    })

    await expect(run()).rejects.toThrow(/cancelled/)

    expect(mocks.segmentAndUploadWindows).not.toHaveBeenCalled()
    expect(mocks.llmCompleteStructured).not.toHaveBeenCalled()
    expect(mocks.markJobCompleted).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
    // Cancellation propagates as a plain error; the handler does NOT refund
    // directly (the cancel route + worker own refund timing). Cleanup still runs.
    expect(mocks.refundJobCredits).not.toHaveBeenCalled()
    expect(mocks.deleteVaTmp).toHaveBeenCalled()
  })
})
