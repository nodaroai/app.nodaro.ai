import { describe, it, expect, vi, beforeEach } from "vitest"

const { getJobsMock } = vi.hoisted(() => ({ getJobsMock: vi.fn() }))

vi.mock("bullmq", () => ({
  Queue: class FakeQueue {
    getJobs = getJobsMock
  },
}))

vi.mock("ioredis", () => ({
  default: class IORedis {},
}))

import { tryRemoveFromQueue } from "../queue.js"

describe("tryRemoveFromQueue", () => {
  beforeEach(() => {
    getJobsMock.mockReset()
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
})
