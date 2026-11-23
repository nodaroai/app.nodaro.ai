import { describe, expect, it, vi } from "vitest"

// The production render's imports (storage, database, ffmpeg) are never reached: each test passes its own render.
vi.mock("../../../lib/supabase.js", () => ({ supabase: {} }))
vi.mock("../../../lib/storage.js", () => ({ uploadLocalFileToR2Key: vi.fn(), r2KeyFromOurUrl: vi.fn() }))
vi.mock("../../../lib/storage-delete.js", () => ({ deleteKeyRecordingFailure: vi.fn() }))

const { createSideBySideJob, sideBySideMarkerKey, sideBySideOwnerKey, KEPT_OFF_RUN_READY_SECONDS, READY_SECONDS } = await import("../video-remake-side-by-side-job.js")
const { JOB_SCRATCH_MAX_AGE_MS } = await import("../../../lib/job-scratch-sweep.js")
type Store = import("../video-remake-side-by-side-job.js").SideBySideStore
type Work = import("../video-remake-side-by-side-job.js").SideBySideWork
const { SIDE_BY_SIDE_RECIPE } = await import("../video-remake-side-by-side.js")

/**
 * The side by side as a background job: one render per run across
 * instances, one at a time per account (another run waits), a failure held
 * briefly and never kept, a finished file held by the marker.
 */
function memoryStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    setNx: async (k, v) => (data.has(k) ? false : (data.set(k, v), true)),
    set: async (k, v) => void data.set(k, v),
    expire: async () => undefined,
    del: async (k) => void data.delete(k),
  }
}

const work = (jobId: string, ownerId = "owner-1", keepOffRun = false): Work => ({
  jobId,
  ownerId,
  resultUrl: `https://cdn.nodaro.ai/videos/${jobId}.mp4`,
  source: { originalUrl: "https://cdn.nodaro.ai/uploads/videos/clip.mp4", startSec: 0, lengthSec: 4 },
  keepOffRun,
})

const record = { v: SIDE_BY_SIDE_RECIPE, url: "https://cdn.nodaro.ai/videos/run-a-side-by-side.mp4", width: 1440, height: 1280, layout: "side" as const }

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe("createSideBySideJob", () => {
  it("starts one render per run; asking again while it runs starts nothing", async () => {
    const store = memoryStore()
    const gate = deferred<typeof record>()
    const render = vi.fn(() => gate.promise)
    const job = createSideBySideJob({ render, store, heartbeatMs: 60_000 })
    expect(await job.start(work("run-a"))).toEqual({ status: "making" })
    expect(await job.start(work("run-a"))).toEqual({ status: "making" })
    expect(render).toHaveBeenCalledTimes(1)
    gate.resolve(record)
    await settle()
    expect(await job.start(work("run-a"))).toEqual({ status: "ready", record })
    expect(render).toHaveBeenCalledTimes(1)
  })

  it("holds the file of a run kept off its row in the marker (its only record) for less than the scratch sweep keeps the file", async () => {
    const store = memoryStore()
    const set = vi.spyOn(store, "set")
    const job = createSideBySideJob({ render: vi.fn(async () => record), store, heartbeatMs: 60_000 })
    await job.start(work("run-t", "owner-1", true))
    await settle()
    expect(set).toHaveBeenCalledWith(sideBySideMarkerKey("run-t"), JSON.stringify({ status: "ready", record }), KEPT_OFF_RUN_READY_SECONDS)
    expect(KEPT_OFF_RUN_READY_SECONDS).toBeGreaterThan(READY_SECONDS)
    expect(KEPT_OFF_RUN_READY_SECONDS * 1000).toBeLessThan(JOB_SCRATCH_MAX_AGE_MS)
    // Asked again (an administrator): the kept file, never a second render.
    expect(await job.start(work("run-t", "owner-1", true))).toEqual({ status: "ready", record })
    await job.start(work("run-o"))
    await settle()
    expect(set).toHaveBeenLastCalledWith(sideBySideMarkerKey("run-o"), expect.any(String), READY_SECONDS)
  })

  it("renders one run at a time per account: another run waits, then starts once the first is done", async () => {
    const store = memoryStore()
    const gate = deferred<typeof record>()
    const render = vi.fn(() => gate.promise)
    const job = createSideBySideJob({ render, store, heartbeatMs: 60_000 })
    await job.start(work("run-a"))
    expect(await job.start(work("run-b"))).toEqual({ status: "waiting" })
    expect(await job.start(work("run-c", "owner-2"))).toEqual({ status: "making" })
    gate.resolve(record)
    await settle()
    expect(store.data.has(sideBySideOwnerKey("owner-1"))).toBe(false)
    expect(await job.start(work("run-b"))).toEqual({ status: "making" })
  })

  it("holds a failure for the next ask, then tries again once it has run out", async () => {
    const store = memoryStore()
    const render = vi.fn(async () => {
      throw new Error("no picture")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const job = createSideBySideJob({ render, store, heartbeatMs: 60_000 })
    await job.start(work("run-a"))
    await settle()
    expect(await job.start(work("run-a"))).toEqual({ status: "failed" })
    expect(store.data.has(sideBySideOwnerKey("owner-1"))).toBe(false)
    store.data.delete(sideBySideMarkerKey("run-a"))
    expect(await job.start(work("run-a"))).toEqual({ status: "making" })
    expect(render).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it("renders here anyway when the store cannot be reached", async () => {
    const render = vi.fn(async () => record)
    const down: Store = {
      get: async () => { throw new Error("down") },
      setNx: async () => { throw new Error("down") },
      set: async () => { throw new Error("down") },
      expire: async () => { throw new Error("down") },
      del: async () => { throw new Error("down") },
    }
    const job = createSideBySideJob({ render, store: down, heartbeatMs: 60_000 })
    expect(await job.start(work("run-a"))).toEqual({ status: "making" })
    await settle()
    expect(render).toHaveBeenCalledTimes(1)
  })

  it("never renders a run kept off its row when the store cannot be reached: the store is its only record", async () => {
    const render = vi.fn(async () => record)
    const down: Store = {
      get: async () => { throw new Error("down") },
      setNx: async () => { throw new Error("down") },
      set: async () => { throw new Error("down") },
      expire: async () => { throw new Error("down") },
      del: async () => { throw new Error("down") },
    }
    const job = createSideBySideJob({ render, store: down, heartbeatMs: 60_000 })
    expect(await job.start(work("run-t", "owner-1", true))).toEqual({ status: "failed" })
    await settle()
    expect(render).not.toHaveBeenCalled()
  })
})
