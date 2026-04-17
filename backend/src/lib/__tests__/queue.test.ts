import { describe, it, expect, vi, beforeEach } from "vitest"

const { getJobMock } = vi.hoisted(() => ({ getJobMock: vi.fn() }))

vi.mock("bullmq", () => ({
  Queue: class FakeQueue {
    getJob = getJobMock
  },
}))

vi.mock("ioredis", () => ({
  default: class IORedis {},
}))

import { tryRemoveFromQueue } from "../queue.js"

describe("tryRemoveFromQueue", () => {
  beforeEach(() => {
    getJobMock.mockReset()
  })

  it("removes a waiting job", async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    getJobMock.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("waiting"),
      remove,
    })
    await tryRemoveFromQueue("job-1")
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("removes a delayed job", async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    getJobMock.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("delayed"),
      remove,
    })
    await tryRemoveFromQueue("job-2")
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("does not remove an active job", async () => {
    const remove = vi.fn()
    getJobMock.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("active"),
      remove,
    })
    await tryRemoveFromQueue("job-3")
    expect(remove).not.toHaveBeenCalled()
  })

  it("is a no-op when job is not found", async () => {
    getJobMock.mockResolvedValue(null)
    await expect(tryRemoveFromQueue("missing")).resolves.toBeUndefined()
  })

  it("swallows errors silently", async () => {
    getJobMock.mockRejectedValue(new Error("redis down"))
    await expect(tryRemoveFromQueue("job-err")).resolves.toBeUndefined()
  })
})
