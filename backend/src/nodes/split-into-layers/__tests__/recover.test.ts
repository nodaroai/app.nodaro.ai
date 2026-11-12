// @test-watches backend/src/nodes/split-into-layers/*.ts
/**
 * A split whose delivery failed, or whose worker died after the provider
 * finished, is finished from its saved task by the reconcile — the worker's
 * stall re-pick (workers/inline-reconcile.ts) and the cron (reconcileKieJob) —
 * through the SAME delivery the worker runs (recover.ts `deliverLayerSplit`):
 * delivered and charged on what was stored, or failed and refunded at once
 * when it cannot be delivered, never parked for the 18-tick bump.
 *
 * Real here: the worker, the inline reconcile, the KIE reconcile, the unit
 * recovery door, this unit's recovery and finalizeJobWithMedia. Mocked: the
 * database, storage and the completion helpers below finalize, KIE (never
 * called), the price rows, and the failure / refund / bump writers (spied).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => {
  const state = { status: "processing", inputData: {} as Record<string, unknown> }
  /** A query chain: every filter returns it, and it resolves (or `.select`s) to an empty success. */
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = Object.assign(Promise.resolve({ data: null, error: null }) as unknown as Record<string, unknown>, {
      eq: () => c,
      in: () => c,
      limit: async () => ({ data: [{ id: "ul-1" }], error: null }),
      select: () => c,
      single: async () => ({
        data: { id: "job-1", user_id: "u1", should_watermark: false, is_public: true, job_type: "split-into-layers", workflow_execution_id: null, status: state.status, input_data: state.inputData, reconcile_attempts: 0 },
        error: null,
      }),
    })
    return c
  }
  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: "2026-11-11T10:00:00+00:00", error: null }))
  const update = vi.fn((_fields: Record<string, unknown>) => chain())
  const from = vi.fn((_table: string) => ({ select: () => chain(), update }))
  return { state, rpc, update, from }
})
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: db.from, rpc: db.rpc } }))

const shared = vi.hoisted(() => ({
  upload: vi.fn(async (_urls: readonly string[], key: string, _user?: string, _wm?: boolean): Promise<readonly string[]> => [`https://r2/${key}.png`]),
  markCompleted: vi.fn(async (_id: string, _fields: Record<string, unknown>, _funnel?: string, _replay?: Record<string, unknown>) => "completed"),
  commit: vi.fn(async (..._args: unknown[]) => undefined),
  createAsset: vi.fn(async (..._args: unknown[]) => undefined),
  progress: vi.fn(async (_job: unknown, _id: string, _pct: number) => undefined),
}))
vi.mock("@/workers/shared.js", () => ({
  uploadImageVariantsMaybeWatermark: shared.upload,
  uploadVideoMaybeWatermark: vi.fn(),
  buildImageOutputData: (_result: unknown, urls: readonly string[]) => ({ imageUrl: urls[0], ...(urls.length > 1 ? { imageUrls: urls } : {}) }),
  markJobCompletedDetailed: shared.markCompleted,
  commitJobCredits: shared.commit,
  refundLoopTrimAddon: vi.fn(),
  createAssetFromJob: shared.createAsset,
  setJobProgress: shared.progress,
  startProgressRamp: () => ({ stop: () => {} }),
}))
vi.mock("@/lib/storage.js", () => ({ uploadToR2: vi.fn() }))
vi.mock("@/lib/gpt-image-2-6-settle.js", () => ({ gptImage26AutoSettledBase: async () => undefined }))

const kie = vi.hoisted(() => ({
  createTask: vi.fn(async (..._args: unknown[]) => ({ taskId: "t-1" })),
  poll: vi.fn(),
  saved: [] as Array<{ jobId: string; kind: string; taskId: string }>,
}))
vi.mock("@/providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/kie/client.js")>()),
  createKieTask: kie.createTask,
  pollKieTask: kie.poll,
}))
vi.mock("@/providers/kie/video.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/kie/video.js")>()),
  ensureImageForProvider: async (url: string) => url,
}))
vi.mock("@/lib/reconcile/persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reconcile/persistence.js")>()),
  makeOnTaskCreated: (jobId: string, kind: string) => async (taskId: string) => { kie.saved.push({ jobId, kind, taskId }) },
}))

const lane = vi.hoisted(() => ({
  base: vi.fn(async (id: string) => ({ "split-into-layers:1k:4": 40, "split-into-layers:1k:3": 31, "split-into-layers:1k:1": 13 } as Record<string, number>)[id]),
  markFailed: vi.fn(async (_id: string, _input: Record<string, unknown>) => true),
  refund: vi.fn(async (_id: string) => 1),
  bump: vi.fn(async (..._args: unknown[]) => undefined),
}))
vi.mock("@/lib/credit-id-base.js", () => ({ creditIdBaseCredits: lane.base }))
vi.mock("@/lib/job-failure.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-failure.js")>()),
  markJobFailed: lane.markFailed,
}))
vi.mock("@/lib/credits-job-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits-job-lifecycle.js")>()),
  refundReservedCreditsForJob: lane.refund,
}))
vi.mock("@/lib/reconcile/bump-attempts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reconcile/bump-attempts.js")>()),
  bumpAttemptsOrExhaust: lane.bump,
}))

import { buildJobInputData } from "@/lib/job-input-data.js"
import { PostProcessingError, isPostProcessingError } from "@/lib/post-processing-error.js"
import { reconcileKieJob } from "@/lib/reconcile/kie.js"
import { tryInlineReconcile } from "@/workers/inline-reconcile.js"
import { descriptor } from "../descriptor.generated.js"
import { LAYER_STORE_ATTEMPTS } from "../recover.js"
import { worker } from "../worker.js"

// What the route queues and writes for a run of 3 layers at 1K (route.ts).
const RUN = { imageUrl: "https://r2/in.png", maxLayers: 3, size: "1K" }
const INPUT_DATA = buildJobInputData(RUN, descriptor.type)
const job = () => ({ data: { jobId: "job-1", ...RUN, model: "seedream-5-5-layer-decomposition", usageLogId: "ul-1" }, updateProgress: async () => {} }) as never
const ctx = { jobId: "job-1", jobUserId: "u1", usageLogId: "ul-1", shouldWatermark: false } as never

// The finished task, as KIE records it: the base and three layers.
const RESULT_JSON = {
  resultObject: {
    layers_data: [
      { z_index: 0, size: "1024x1024", url: "https://kie/base.png" },
      { z_index: 1, name: "Caption", size: "800x200", bounding_box: { absolute: [10, 800, 810, 1000], normalized: [10, 781, 791, 977] }, url: "https://kie/l1.png" },
      { z_index: 2, name: "Fox", size: "500x400", url: "https://kie/l2.png" },
      { z_index: 3, name: "Tree", url: "https://kie/l3.png" },
    ],
  },
  resultUrls: ["https://kie/base.png", "https://kie/l1.png", "https://kie/l2.png", "https://kie/l3.png"],
}
const RECORD = { resultJson: RESULT_JSON, providerMs: 25000, rawRecordInfo: { code: 200, data: { creditsConsumed: 15.84 } }, taskId: "t-1" }

/** The row the video worker's stall re-pick and the cron hand the reconcile. */
const savedRow = () => ({
  id: "job-1",
  provider_kind: kie.saved[0]?.kind ?? "kie-standard",
  provider_task_id: kie.saved[0]?.taskId ?? "t-1",
  reconcile_attempts: 0,
  job_type: descriptor.type,
  input_data: INPUT_DATA,
})

/** Base uploads (`job-1`) fail this many times, then succeed; the keys in `failing` fail every time. */
function storage({ baseFailures = 0, failing = [] as string[] } = {}) {
  let left = baseFailures
  shared.upload.mockImplementation(async (_urls, key) => {
    if (key === "job-1" && left > 0) { left--; throw new PostProcessingError("R2 down") }
    if (failing.includes(key)) throw new PostProcessingError("R2 down")
    return [`https://r2/${key}.png`]
  })
}

const completedFields = () => shared.markCompleted.mock.calls[0]![1] as { output_data: Record<string, unknown>; provider_task_id?: string; provider?: string }
const committedCredits = () => shared.commit.mock.calls[0]![3]
const claimant = () => (db.rpc.mock.calls.find(([fn]) => fn === "claim_job_finalize")![1] as { p_claimant: string }).p_claimant

beforeEach(() => {
  vi.clearAllMocks()
  kie.saved.length = 0
  kie.poll.mockResolvedValue(RECORD)
  shared.progress.mockImplementation(async () => undefined)
  db.state.status = "processing"
  db.state.inputData = INPUT_DATA
  storage()
})

describe("split-into-layers: the reconcile finishes the job from its saved task", () => {
  it("a base store that fails in the worker's attempt, then succeeds on the stall re-pick: delivered by the reconcile through the same finalize, charged on the stored count, and the provider is never asked twice", async () => {
    // The worker's attempt: every one of the base's store attempts fails.
    storage({ baseFailures: LAYER_STORE_ATTEMPTS })
    const err = await worker(job(), ctx).then(() => null, (e: unknown) => e)
    expect((err as Error).message).toMatch(/the base picture could not be saved/)
    expect(isPostProcessingError(err)).toBe(false) // refundable on a final attempt
    expect(shared.markCompleted).not.toHaveBeenCalled()
    expect(kie.saved).toEqual([{ jobId: "job-1", kind: "kie-standard", taskId: "t-1" }])

    // BullMQ retries; the pickup sees the saved task and runs the inline reconcile.
    vi.clearAllMocks()
    await tryInlineReconcile(savedRow())

    expect(kie.createTask).not.toHaveBeenCalled()
    expect(kie.poll).toHaveBeenCalledWith("t-1", expect.any(Number), undefined, expect.anything())
    expect(claimant()).toBe("worker")
    const out = completedFields().output_data
    expect(out.imageUrl).toBe("https://r2/job-1.png")
    expect(out.layers).toEqual(["https://r2/job-1-layers-1.png", "https://r2/job-1-layers-2.png", "https://r2/job-1-layers-3.png"])
    expect(out.layerCount).toBe(3)
    expect(out.layersNotSaved).toBe(0)
    expect(completedFields().provider_task_id).toBe("t-1")
    // The base + 3 stored layers = 4 images at the 1K row.
    expect(lane.base).toHaveBeenCalledWith("split-into-layers:1k:4")
    expect(committedCredits()).toBe(40)
    expect(shared.createAsset).toHaveBeenCalled()
    expect(lane.markFailed).not.toHaveBeenCalled()
    expect(lane.refund).not.toHaveBeenCalled()
    expect(lane.bump).not.toHaveBeenCalled()
  })

  it("a worker that died after the provider finished: the cron delivers the job, drops a layer that cannot be stored as the worker would, and charges what was stored", async () => {
    // The process dies right after the provider call returned (the task is saved; nothing finalized).
    shared.progress.mockImplementation(async (_job, _id, pct) => {
      if (pct === 85) throw new Error("SIGKILL")
      return undefined
    })
    await expect(worker(job(), ctx)).rejects.toThrow("SIGKILL")
    expect(shared.markCompleted).not.toHaveBeenCalled()

    vi.clearAllMocks()
    storage({ failing: ["job-1-layers-2"] })
    await reconcileKieJob(savedRow())

    expect(claimant()).toBe("cron")
    const out = completedFields().output_data
    expect(out.layers).toEqual(["https://r2/job-1-layers-1.png", "https://r2/job-1-layers-3.png"])
    expect(out.layersNotSaved).toBe(1)
    expect((out.layerData as Array<{ name?: string; url: string }>).map((l) => [l.name, l.url])).toEqual([
      ["Caption", "https://r2/job-1-layers-1.png"],
      ["Tree", "https://r2/job-1-layers-3.png"],
    ])
    expect(out.libraryImages).toEqual([{ url: "https://r2/job-1-layers-1.png", name: "Caption" }, { url: "https://r2/job-1-layers-3.png", name: "Tree" }])
    // The dropped layer was tried as often as the worker tries it.
    expect(shared.upload.mock.calls.filter(([, key]) => key === "job-1-layers-2")).toHaveLength(LAYER_STORE_ATTEMPTS)
    // The base + 2 stored layers = 3 images.
    expect(lane.base).toHaveBeenCalledWith("split-into-layers:1k:3")
    expect(committedCredits()).toBe(31)
    expect(lane.refund).not.toHaveBeenCalled()
    expect(lane.bump).not.toHaveBeenCalled()
  })

  it.each([
    ["no base in the result", { resultObject: { layers_data: [{ z_index: 1, url: "not-a-url" }] } }],
    ["a result that is not a record", "garbage"],
  ])("a result that cannot be read (%s): failed and refunded on this tick, never bumped, nothing stored", async (_what, resultJson) => {
    kie.poll.mockResolvedValue({ ...RECORD, resultJson })
    await reconcileKieJob(savedRow())
    expect(lane.markFailed).toHaveBeenCalledTimes(1)
    expect(lane.markFailed.mock.calls[0]![1]).toMatchObject({ reconcile_last_error: "delivery_failed" })
    expect(lane.refund).toHaveBeenCalledWith("job-1")
    expect(lane.bump).not.toHaveBeenCalled()
    expect(shared.upload).not.toHaveBeenCalled()
    expect(shared.markCompleted).not.toHaveBeenCalled()
  })

  it("a base that still cannot be stored on the re-pick: failed and refunded at once with the worker's own words, never bumped", async () => {
    storage({ baseFailures: 99 })
    await tryInlineReconcile(savedRow())
    expect(shared.upload.mock.calls.filter(([, key]) => key === "job-1")).toHaveLength(LAYER_STORE_ATTEMPTS)
    expect(lane.markFailed.mock.calls[0]![1]).toMatchObject({
      error_message: expect.stringMatching(/the base picture could not be saved/),
      reconcile_last_error: "delivery_failed",
    })
    expect(lane.refund).toHaveBeenCalledWith("job-1")
    expect(lane.bump).not.toHaveBeenCalled()
  })

  it("a single run: each layer's data names the base it was cut from as STORED — exactly the job's output_data.imageUrl, never the provider's file", async () => {
    await worker(job(), ctx)
    const out = completedFields().output_data
    expect(out.imageUrl).toBe("https://r2/job-1.png")
    const layerData = out.layerData as Array<{ url: string; baseUrl: string; row?: number }>
    expect(layerData).toHaveLength(3)
    for (const l of layerData) {
      expect(l.baseUrl).toBe(out.imageUrl)
      // A single run's layer data carries no row: that is a batch's.
      expect(l.row).toBeUndefined()
    }
    // The same on the reconcile's delivery (the stall re-pick).
    vi.clearAllMocks()
    await tryInlineReconcile(savedRow())
    const recovered = completedFields().output_data
    expect((recovered.layerData as Array<{ baseUrl: string }>).map((l) => l.baseUrl)).toEqual(Array(3).fill("https://r2/job-1.png"))
  })

  it("the worker and the reconcile run the one delivery with equal inputs: the same uploads, completion, commit and asset", async () => {
    storage({ failing: ["job-1-layers-2"] })
    await worker(job(), ctx)
    const effects = () => ({
      uploads: shared.upload.mock.calls.map(([urls, key, user, wm]) => [urls, key, user, wm]),
      completion: shared.markCompleted.mock.calls,
      commit: shared.commit.mock.calls,
      asset: shared.createAsset.mock.calls,
      claim: db.rpc.mock.calls,
    })
    const byWorker = effects()
    expect(byWorker.completion).toHaveLength(1)

    vi.clearAllMocks()
    storage({ failing: ["job-1-layers-2"] })
    await tryInlineReconcile(savedRow())
    expect(effects()).toEqual(byWorker)
  })

  it("the delivery is one function: the unit's one finalize call is in it, and the worker and the recovery both call it", () => {
    const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
    const files = ["worker.ts", "recover.ts", "route.ts", "payload.ts"]
    const finalizeCalls = files.flatMap((f) => [...src(f).matchAll(/finalizeJobWithMedia\s*\(/g)].map(() => f))
    expect(finalizeCalls).toEqual(["recover.ts"])
    expect(src("recover.ts")).toMatch(/export async function deliverLayerSplit\([\s\S]*?finalizeJobWithMedia\(/)
    expect(src("worker.ts")).toMatch(/\bdeliverLayerSplit\(/)
    expect(src("recover.ts")).toMatch(/export const recover: UnitRecover = [\s\S]*?\bdeliverLayerSplit\(/)
  })
})
