import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSingle = vi.fn()
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: mockSingle }) }) }),
  },
}))

import { runWithJobCancellation, throwIfJobCancelled, JobCancelledError } from "../job-cancellation.js"

describe("job-cancellation", () => {
  beforeEach(() => mockSingle.mockReset())

  it("is a no-op (no DB read) outside a cancellation context", async () => {
    await expect(throwIfJobCancelled()).resolves.toBeUndefined()
    expect(mockSingle).not.toHaveBeenCalled()
  })

  it("does not throw while the job is still running", async () => {
    mockSingle.mockResolvedValue({ data: { status: "processing" }, error: null })
    await runWithJobCancellation("job-1", async () => {
      await expect(throwIfJobCancelled()).resolves.toBeUndefined()
    })
    expect(mockSingle).toHaveBeenCalledTimes(1)
  })

  it("throws JobCancelledError once the job is cancelled, and is sticky without re-querying", async () => {
    mockSingle.mockResolvedValue({ data: { status: "cancelled" }, error: null })
    await runWithJobCancellation("job-2", async () => {
      await expect(throwIfJobCancelled()).rejects.toBeInstanceOf(JobCancelledError)
      await expect(throwIfJobCancelled()).rejects.toBeInstanceOf(JobCancelledError)
      expect(mockSingle).toHaveBeenCalledTimes(1)
    })
  })

  it("throttles DB reads within the check window", async () => {
    mockSingle.mockResolvedValue({ data: { status: "processing" }, error: null })
    await runWithJobCancellation("job-3", async () => {
      await throwIfJobCancelled()
      await throwIfJobCancelled() // within the throttle window → no second query
      expect(mockSingle).toHaveBeenCalledTimes(1)
    })
  })
})
