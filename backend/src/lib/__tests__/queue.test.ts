import { describe, it, expect, vi, beforeEach } from "vitest"

const { getJobsMock, fromIdMock, order, lanes } = vi.hoisted(() => ({
  getJobsMock: vi.fn(),
  /** Job.fromId(queue, id) — the lookup of a job's stored BullMQ entry. */
  fromIdMock: vi.fn(),
  /** What ran, in order: the withdraw, the stored-entry lookup, the scan. */
  order: [] as string[],
  lanes: {
    entry: null as { queue: string; bullJobId: string; status?: string | null } | null,
    withdraw: vi.fn(async (_jobId: string) => {}),
  },
}))

vi.mock("bullmq", () => ({
  Queue: class FakeQueue {
    constructor(readonly name: string) {}
    getJobs = (...a: unknown[]) => {
      order.push(`scan:${this.name}`)
      return getJobsMock(...a)
    }
  },
  Job: {
    fromId: (queue: { name: string }, id: string) => {
      order.push(`fromId:${queue.name}/${id}`)
      return fromIdMock(queue, id)
    },
  },
}))
vi.mock("../concurrency-lanes/withdraw.js", () => ({
  withdrawFromLane: async (jobId: string) => {
    order.push(`withdraw:${jobId}`)
    await lanes.withdraw(jobId)
  },
}))
vi.mock("../concurrency-lanes/columns.js", () => ({ readBullEntry: async () => lanes.entry }))

vi.mock("ioredis", () => ({
  default: class IORedis {},
}))

import { oneScanAtATime, tryRemoveFromQueue } from "../queue.js"

describe("tryRemoveFromQueue", () => {
  beforeEach(() => {
    getJobsMock.mockReset()
    fromIdMock.mockReset().mockResolvedValue(undefined)
    order.length = 0
    lanes.entry = null
    lanes.withdraw.mockReset().mockResolvedValue(undefined)
  })

  // BullMQ entry ids are auto-generated (no add() site passes a custom jobId),
  // so removal scans not-yet-picked states for an entry whose data.jobId is
  // the DB job id. Audit A1: the old getJob(<db uuid>) lookup could never
  // match, making every cancel-time removal a silent no-op.
  it("scans prioritized/waiting/delayed and removes the entry whose data.jobId matches", async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const otherRemove = vi.fn()
    getJobsMock.mockResolvedValue([
      { data: { jobId: "other-job" }, remove: otherRemove },
      { data: { jobId: "job-1" }, remove },
    ])

    await tryRemoveFromQueue("job-1")

    expect(getJobsMock).toHaveBeenCalledWith(
      ["prioritized", "waiting", "delayed"],
      0,
      expect.any(Number),
    )
    expect(remove).toHaveBeenCalledTimes(1)
    expect(otherRemove).not.toHaveBeenCalled()
  })

  it("does not touch active jobs (only queued states are scanned)", async () => {
    // The scan itself excludes "active" — assert the state list never asks
    // for it, so an in-flight job can't be yanked mid-execution.
    getJobsMock.mockResolvedValue([])
    await tryRemoveFromQueue("job-3")
    const states = getJobsMock.mock.calls[0]![0] as string[]
    expect(states).not.toContain("active")
  })

  it("is a no-op when no queued entry matches", async () => {
    getJobsMock.mockResolvedValue([{ data: { jobId: "someone-else" }, remove: vi.fn() }])
    await expect(tryRemoveFromQueue("missing")).resolves.toBeUndefined()
  })

  it("tolerates malformed queue entries (missing data)", async () => {
    getJobsMock.mockResolvedValue([null, {}, { data: null }, { data: { jobId: "job-4" }, remove: vi.fn() }])
    await expect(tryRemoveFromQueue("job-4")).resolves.toBeUndefined()
  })

  it("swallows errors silently", async () => {
    getJobsMock.mockRejectedValue(new Error("redis down"))
    await expect(tryRemoveFromQueue("job-err")).resolves.toBeUndefined()
  })

  // ── concurrency lanes: the shared removal funnel withdraws, then removes by stored id ──

  const entry = (over: Record<string, unknown> = {}) => ({
    data: { jobId: "job-q" },
    getState: vi.fn(async () => "delayed"),
    remove: vi.fn(async () => {}),
    ...over,
  })

  it("cancelling a queued job withdraws it, then removes it by its stored BullMQ id (no scan)", async () => {
    lanes.entry = { queue: "video-generation", bullJobId: "bull-9" }
    const parked = entry()
    fromIdMock.mockResolvedValue(parked)

    await tryRemoveFromQueue("job-q")

    expect(order).toEqual(["withdraw:job-q", "fromId:video-generation/bull-9"])
    expect(parked.remove).toHaveBeenCalledTimes(1)
    expect(getJobsMock).not.toHaveBeenCalled()
  })

  it("finds a stored render entry on the render queue and a director's on the director queue", async () => {
    for (const queue of ["video-render", "video-director"]) {
      order.length = 0
      lanes.entry = { queue, bullJobId: "b" }
      const parked = entry()
      fromIdMock.mockResolvedValue(parked)
      await tryRemoveFromQueue("job-q")
      expect(order).toEqual(["withdraw:job-q", `fromId:${queue}/b`])
      expect(parked.remove).toHaveBeenCalledTimes(1)
    }
  })

  it("an unstamped job (or one whose stored entry is gone) falls back to the 500-entry scan", async () => {
    getJobsMock.mockResolvedValue([])
    await tryRemoveFromQueue("job-q")
    expect(order).toEqual(["withdraw:job-q", "scan:video-generation", "scan:video-render"])

    order.length = 0
    lanes.entry = { queue: "video-generation", bullJobId: "gone" }
    fromIdMock.mockResolvedValue(undefined)
    await tryRemoveFromQueue("job-q")
    expect(order).toEqual(["withdraw:job-q", "fromId:video-generation/gone", "scan:video-generation", "scan:video-render"])
  })

  it("never removes a stored entry that is running, and does not scan for a job that started", async () => {
    lanes.entry = { queue: "video-generation", bullJobId: "bull-9", status: "processing" }
    const running = entry({ getState: vi.fn(async () => "active") })
    fromIdMock.mockResolvedValue(running)
    await tryRemoveFromQueue("job-q")
    expect(running.remove).not.toHaveBeenCalled()
    expect(getJobsMock).not.toHaveBeenCalled()
  })

  // The stamp names the entry that last picked the job up. A row still
  // waiting (pending/queued) whose stamped entry is active is a pickup in
  // progress — another entry of the same job may still sit in the queue
  // (re-added), so the scan still runs; it never touches an active entry.
  for (const status of ["pending", "queued"]) {
    it(`a stamped entry that is active while the row is still ${status} falls through to the scan`, async () => {
      lanes.entry = { queue: "video-generation", bullJobId: "bull-9", status }
      const active = entry({ getState: vi.fn(async () => "active") })
      fromIdMock.mockResolvedValue(active)
      const other = { data: { jobId: "job-q" }, remove: vi.fn(async () => {}) }
      getJobsMock.mockResolvedValue([other])
      await tryRemoveFromQueue("job-q")
      expect(active.remove).not.toHaveBeenCalled()
      expect(other.remove).toHaveBeenCalledTimes(1)
    })
  }

  it("never removes a stored entry that carries another job; it scans instead", async () => {
    lanes.entry = { queue: "video-generation", bullJobId: "bull-9" }
    const other = entry({ data: { jobId: "someone-else" } })
    fromIdMock.mockResolvedValue(other)
    getJobsMock.mockResolvedValue([])
    await tryRemoveFromQueue("job-q")
    expect(other.remove).not.toHaveBeenCalled()
    expect(getJobsMock).toHaveBeenCalled()
  })

  it("a stamp on a queue that carries no jobs rows falls back to the scan", async () => {
    lanes.entry = { queue: "workflow-orchestration", bullJobId: "b" }
    getJobsMock.mockResolvedValue([])
    await tryRemoveFromQueue("job-q")
    expect(order).toEqual(["withdraw:job-q", "scan:video-generation", "scan:video-render"])
  })

  it("removals sharing one runner (cancel-all) scan one at a time; without one, each scans at once", async () => {
    let scanning = 0
    let peak = 0
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    getJobsMock.mockImplementation(async () => {
      scanning++
      peak = Math.max(peak, scanning)
      await held
      scanning--
      return []
    })
    // Started apart, so their lazy imports never overlap (vitest's module mocks hang on that).
    const settle = () => new Promise((r) => setTimeout(r, 20))
    const scans = oneScanAtATime()
    // No stored entry: every removal falls back to the scan. job-a's scan is held open...
    const a = tryRemoveFromQueue("job-a", scans)
    await vi.waitFor(() => expect(scanning).toBe(1))
    // ...and a removal sharing its runner waits for it instead of scanning beside it.
    const b = tryRemoveFromQueue("job-b", scans)
    await settle()
    expect(order).toContain("withdraw:job-b")
    expect(getJobsMock).toHaveBeenCalledTimes(1)
    // A removal with no runner (a single cancel) is not held up by it.
    const c = tryRemoveFromQueue("job-c")
    await vi.waitFor(() => expect(scanning).toBe(2))
    release()
    await Promise.all([a, b, c])
    expect(getJobsMock).toHaveBeenCalledTimes(6) // both queues, per job
    expect(peak).toBe(2) // job-a's and job-c's, never job-b's beside job-a's
  })

  it("on a shared runner, a scan that fails does not hold up the next one", async () => {
    getJobsMock.mockRejectedValueOnce(new Error("redis down")).mockResolvedValue([])
    const scans = oneScanAtATime()
    await expect(tryRemoveFromQueue("job-d", scans)).resolves.toBeUndefined()
    await tryRemoveFromQueue("job-e", scans)
    expect(getJobsMock).toHaveBeenCalledTimes(3)
  })

  it("withdraws even when the removal fails, and never throws", async () => {
    lanes.entry = { queue: "video-generation", bullJobId: "bull-9" }
    fromIdMock.mockRejectedValue(new Error("redis down"))
    getJobsMock.mockRejectedValue(new Error("redis down"))
    await expect(tryRemoveFromQueue("job-q")).resolves.toBeUndefined()
    expect(lanes.withdraw).toHaveBeenCalledWith("job-q")
  })
})
