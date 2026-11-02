// The render queue's concurrency slot (lib/concurrency-lanes/worker-admit.ts):
// taken above every branch — the early `scene-render-child` return included —
// held while the render runs, and released exactly once on every exit. The
// real admission, on the gate's JS twin.
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const rows = { record: null as Record<string, unknown> | null, claimed: [{ id: "job-1" }] as Array<{ id: string }> }
  const statusFilters: unknown[][] = []
  const updates: Array<Record<string, unknown>> = []
  /** The column lists of every read (not an update's returning list). */
  const selects: unknown[] = []
  /** Every delete, as [table, ...its filters]. */
  const deletes: unknown[][] = []
  const from = vi.fn((table?: string) => {
    const chain: Record<string, unknown> = {}
    let deleting: unknown[] | null = null
    let isUpdate = false
    chain.select = vi.fn((cols?: unknown) => {
      if (isUpdate) return Promise.resolve({ data: rows.claimed, error: null })
      selects.push(cols)
      return chain
    })
    chain.update = vi.fn((fields: Record<string, unknown>) => { isUpdate = true; updates.push(fields); return chain })
    chain.delete = vi.fn(() => { deleting = [table]; deletes.push(deleting); return chain })
    chain.eq = vi.fn((col: string, value: unknown) => { deleting?.push([col, value]); return chain })
    chain.in = vi.fn((col: string, values: unknown[]) => {
      if (deleting) deleting.push([col, values])
      else statusFilters.push([col, values])
      return chain
    })
    chain.is = vi.fn(() => chain)
    chain.single = vi.fn(() => Promise.resolve({ data: rows.record, error: null }))
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res, rej)
    return chain
  })
  return {
    rows, statusFilters, updates, selects, deletes, from,
    processor: null as null | ((job: unknown, token?: string) => Promise<unknown>),
    workerOptions: undefined as Record<string, unknown> | undefined,
    sceneChild: vi.fn(async () => undefined),
    createWorkDir: vi.fn(async () => "/tmp/render-lanes-test"),
    isFinal: vi.fn(() => true),
  }
})

const lanes = vi.hoisted(() => ({ gate: null as unknown, sizes: { provider: 1, llm: 2, local: 1, run: 1 } }))
// Waiting is tested here, so turning limits on is made available; a case sets
// `lanesAvailable.on = false` for the shipped, locked path.
const lanesAvailable = vi.hoisted(() => ({ on: true }))
vi.mock("../../lib/concurrency-lanes/enforcement-available.js", () => ({ get LANES_ENFORCEMENT_AVAILABLE() { return lanesAvailable.on } }))

vi.mock("../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => lanes.gate }))
vi.mock("../../lib/concurrency-lanes/sizes.js", () => ({ laneSizesFor: async () => lanes.sizes }))

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", REMOTION_CONCURRENCY: undefined, RENDER_WORKER_CONCURRENCY: 2 },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("@/lib/storage.js", () => ({ uploadFileToR2: vi.fn() }))
vi.mock("@/utils/watermark.js", () => ({ applyVideoWatermark: vi.fn() }))
vi.mock("@/lib/access-blocks.js", () => ({ isUserQuietStopped: vi.fn(async () => false), QUIET_STOP_RECHECK_MS: 600_000 }))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailed: vi.fn(async () => true) }))
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
  commitJobCredits: vi.fn(),
  refundJobCredits: vi.fn(),
  shouldSaveJobResult: vi.fn(async () => true),
  generateAndUploadThumbnail: vi.fn(),
  createAssetFromJob: vi.fn(),
  markJobCompletedDetailed: vi.fn(async () => "completed"),
  isFinalJobAttempt: mocks.isFinal,
}))
vi.mock("../scene3d-render-child.js", () => ({ processSceneRenderChild: mocks.sceneChild }))
vi.mock("bullmq", () => {
  class Worker {
    constructor(_q: string, processor: (job: unknown, token?: string) => Promise<unknown>, opts?: Record<string, unknown>) {
      mocks.processor = processor
      mocks.workerOptions = opts
    }
  }
  class DelayedError extends Error {}
  return { Worker, DelayedError }
})
vi.mock("ioredis", () => { class FakeRedis {}; return { default: FakeRedis } })
vi.mock("@remotion/bundler", () => ({ bundle: vi.fn(async () => "/tmp/bundle") }))
vi.mock("@remotion/renderer", () => ({ selectComposition: vi.fn(), renderMedia: vi.fn() }))
// createRenderWorker sweeps stale `render-*` work dirs under the OS temp dir at
// boot: point it at a directory that does not exist, so a test never touches
// this machine's real temp dir.
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  tmpdir: () => "/nonexistent-render-lanes-test",
}))

import { ConcurrencyGate } from "../../lib/concurrency-lanes/gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { currentConcurrencyHold } from "../../lib/concurrency-lanes/hold.js"
import { resetWorkerAdmitHooksForTests } from "../../lib/concurrency-lanes/worker-admit.js"
import { resetServerShareForTests, serverShareOf } from "../../lib/concurrency-lanes/server-share.js"
import { DrainAbortError } from "../../lib/worker-drain.js"
import { DelayedError } from "bullmq"
import { createRenderWorker } from "../render-worker.js"

let gate: ConcurrencyGate

const record = (over: Record<string, unknown> = {}) => ({
  usage_log_id: "usage-1", user_id: "U", status: "pending", started_at: null, parent_job_id: null, workflow_execution_id: null,
  pipeline_id: null, workspace_id: null, org_id: null, source: null, source_detail: null, mcp_client: null, force_private: false,
  should_watermark: false, profiles: { tier: "pro", public_outputs: true }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  const store = makeFakeLaneStore()
  gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
  lanes.gate = gate
  resetWorkerAdmitHooksForTests()
  mocks.rows.record = record()
  mocks.rows.claimed = [{ id: "job-1" }]
  mocks.statusFilters.length = 0
  mocks.updates.length = 0
  mocks.selects.length = 0
  mocks.deletes.length = 0
  mocks.isFinal.mockReturnValue(true)
  resetServerShareForTests()
  createRenderWorker()
})

const renderJob = (over: Record<string, unknown> = {}) => ({
  id: "bull-r1", name: "render-video", data: { jobId: "job-1", template: "slideshow" }, updateProgress: vi.fn(async () => undefined),
  moveToDelayed: vi.fn(async () => undefined), ...over,
})

describe("render worker — concurrency slot", () => {
  it("scene-render-child is admitted before its early return", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    const release = vi.spyOn(gate, "release")
    mocks.rows.record = record({ parent_job_id: "scene-parent", workspace_id: "W1" })
    let hold: unknown
    mocks.sceneChild.mockImplementationOnce(async () => { hold = currentConcurrencyHold() })
    await mocks.processor!({ id: "bull-c1", name: "scene-render-child", data: { jobId: "job-1", sceneRenderChild: true }, moveToDelayed: vi.fn() })
    expect(mocks.sceneChild).toHaveBeenCalledTimes(1)
    expect(acquire.mock.calls[0]![0]).toMatchObject({ mode: "front", meta: { lane: "local", provider: "local", payer: "workspace:W1", queue: "video-render", bullJobId: "bull-c1" } })
    expect(hold).toMatchObject({ role: "leaf", lane: "local", jobId: "job-1", leaseId: expect.any(String) })
    expect(release).toHaveBeenCalledTimes(1)
    expect(release.mock.calls[0]![1]).toBe("completed")
  })

  it("a scene-render-child's pickup reads only what admission needs, with no profile join", async () => {
    await mocks.processor!({ id: "bull-c1", name: "scene-render-child", data: { jobId: "job-1", sceneRenderChild: true }, moveToDelayed: vi.fn() })
    const { WORKER_ROW_COLUMNS } = await import("../../lib/concurrency-lanes/worker-admit.js")
    expect(mocks.selects[0]).toBe(WORKER_ROW_COLUMNS)
    // A render job still reads its full row, the profile included.
    mocks.rows.claimed = []
    await mocks.processor!(renderJob())
    expect(mocks.selects.at(-1)).toEqual(expect.stringContaining("profiles!user_id"))
  })

  it("the render pickup claim records the job's BullMQ entry in the same UPDATE: one statement per pickup", async () => {
    mocks.rows.claimed = []
    await mocks.processor!(renderJob())
    const claims = mocks.updates.filter((u) => u.status === "processing")
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ status: "processing", started_at: expect.any(String), lane_bull_queue: "video-render", lane_bull_job_id: "bull-r1" })
    expect(mocks.updates.filter((u) => u.status !== "processing" && Object.keys(u).some((k) => k.startsWith("lane_")))).toEqual([])
    expect(mocks.statusFilters).toEqual([["status", ["pending", "queued", "processing"]]])
  })

  it("releases on completion and on cancel", async () => {
    const release = vi.spyOn(gate, "release")
    // Completion: a scene-render-child that finished.
    await mocks.processor!({ id: "bull-c1", name: "scene-render-child", data: { jobId: "job-1", sceneRenderChild: true }, moveToDelayed: vi.fn() })
    // Cancel: a render job whose row was cancelled while it was queued.
    mocks.rows.claimed = []
    await mocks.processor!(renderJob())
    expect(release.mock.calls.map((c) => c[1])).toEqual(["completed", "cancelled"])
  })

  it("a job that waited has its requeue payload deleted once its claim wins; one that never waited does not", async () => {
    // The render stops right after its claim (a drain at its first progress write).
    const drainedAfterClaim = () => renderJob({ updateProgress: vi.fn(async () => { throw new DrainAbortError() }) })
    mocks.rows.record = record({ status: "queued" })
    await expect(mocks.processor!(drainedAfterClaim())).rejects.toBeInstanceOf(DrainAbortError)
    await vi.waitFor(() => expect(mocks.deletes).toEqual([["lane_requeue_payloads", ["kind", "job"], ["row_id", ["job-1"]]]]))

    mocks.rows.record = record({ status: "pending" })
    await expect(mocks.processor!(drainedAfterClaim())).rejects.toBeInstanceOf(DrainAbortError)
    await new Promise((r) => setTimeout(r, 0))
    expect(mocks.deletes).toHaveLength(1)

    // A claim that lost (the row was cancelled meanwhile) deletes nothing.
    mocks.rows.record = record({ status: "queued" })
    mocks.rows.claimed = []
    await mocks.processor!(renderJob())
    await new Promise((r) => setTimeout(r, 0))
    expect(mocks.deletes).toHaveLength(1)
  })

  it("a drain during the render goes back to the queue as requeued", async () => {
    const release = vi.spyOn(gate, "release")
    mocks.createWorkDir.mockRejectedValueOnce(new DrainAbortError())
    await expect(mocks.processor!(renderJob())).rejects.toBeInstanceOf(DrainAbortError)
    expect(release).toHaveBeenCalledTimes(1)
    expect(release.mock.calls[0]![1]).toBe("requeued")
  })

  it("the captions render hand-off is readmitted at its own pickup", async () => {
    const acquire = vi.spyOn(gate, "acquire")
    // The render job of an add-captions job: the row is still `processing`, and the user's local lane is full.
    await gate.setEnforced(true)
    await gate.acquire({
      meta: { jobId: "other", userId: "U", payer: "user:U", lane: "local", provider: "local", source: null, sourceDetail: null, jobType: "trim-video", model: null, queue: "video-generation", bullJobId: "other" },
      size: 1, mode: "fresh", leaseTtlMs: 60_000,
    })
    mocks.rows.record = record({ status: "processing" })
    mocks.rows.claimed = []
    await mocks.processor!(renderJob({ id: "render-job-1", name: "render", data: { jobId: "job-1", planType: "burn-captions" } }))
    expect(acquire.mock.calls.at(-1)![0].mode).toBe("readmit")
  })

  it("the pickup CAS accepts a queued row, and a lane-readd entry only a queued one", async () => {
    mocks.rows.claimed = []
    await mocks.processor!(renderJob())
    await mocks.processor!(renderJob({ id: "lane-readd-job-1" }))
    expect(mocks.statusFilters).toEqual([["status", ["pending", "queued", "processing"]], ["status", ["queued"]]])
  })

  it("a job its lane refuses is parked: row queued, delayed by the backstop, nothing renders", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await gate.setEnforced(true)
    await gate.acquire({
      meta: { jobId: "other", userId: "U", payer: "user:U", lane: "local", provider: "local", source: null, sourceDetail: null, jobType: "trim-video", model: null, queue: "video-generation", bullJobId: "other" },
      size: 1, mode: "fresh", leaseTtlMs: 60_000,
    })
    const release = vi.spyOn(gate, "release")
    const job = renderJob()
    const before = Date.now()
    await expect(mocks.processor!(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)
    expect(mocks.createWorkDir).not.toHaveBeenCalled()
    expect(mocks.updates).toContainEqual({ status: "queued" })
    expect(mocks.updates.some((u) => u.status === "processing")).toBe(false)
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "lock-token")
    expect((job.moveToDelayed.mock.calls[0] as unknown as [number])[0]).toBeGreaterThanOrEqual(before + 600_000)
    expect(release).not.toHaveBeenCalled()
  })

  it("with enforcement off nothing is parked", async () => {
    await gate.setEnforced(false)
    await gate.acquire({
      meta: { jobId: "other", userId: "U", payer: "user:U", lane: "local", provider: "local", source: null, sourceDetail: null, jobType: "trim-video", model: null, queue: "video-generation", bullJobId: "other" },
      size: 1, mode: "fresh", leaseTtlMs: 60_000,
    })
    const job = renderJob()
    mocks.rows.claimed = []
    await mocks.processor!(job, "lock-token")
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(mocks.updates).not.toContainEqual({ status: "queued" })
  })

  /** Another render of user `userId` running on this process's pool. */
  const holdRenderShare = (userId = "U") => {
    const e = serverShareOf("render").tryEnter({ userId, jobId: `running-${userId}`, coordinator: false, exempt: false })
    if (!e.entered) throw new Error("expected an entry")
    return e
  }

  it("a render job over its user's server share waits as queued", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await gate.setEnforced(true)
    holdRenderShare()
    const acquire = vi.spyOn(gate, "acquire")
    const job = renderJob()
    await expect(mocks.processor!(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)
    expect(mocks.createWorkDir).not.toHaveBeenCalled()
    expect(mocks.updates).toContainEqual({ status: "queued" })
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "lock-token")
    // Refused by the share before any lane acquire: it holds no slot while it waits.
    expect(acquire).not.toHaveBeenCalled()
    expect(await gate.describeWait("job-1")).toMatchObject({ reason: "server_busy" })
  })

  it("a render pool of 2 admits one job per user", async () => {
    await gate.setEnforced(true)
    expect(serverShareOf("render").occupancy()).toMatchObject({ poolSize: 2, userCap: 1 })
    holdRenderShare("U")
    // Another user's render runs at once.
    mocks.rows.record = record({ user_id: "V" })
    mocks.rows.claimed = []
    const job = renderJob()
    await mocks.processor!(job, "lock-token")
    expect(job.moveToDelayed).not.toHaveBeenCalled()
    expect(mocks.updates).not.toContainEqual({ status: "queued" })
  })

  it("maxStartedAttempts stays unset on the render worker", () => {
    expect(mocks.workerOptions).toBeDefined()
    expect(mocks.workerOptions).not.toHaveProperty("maxStartedAttempts")
  })
})
