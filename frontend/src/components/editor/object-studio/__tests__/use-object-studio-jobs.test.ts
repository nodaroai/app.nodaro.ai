import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"

// Hoisted mock — must precede the SUT import.
vi.mock("@/lib/api", () => ({
  getJobStatusBatch: vi.fn(),
}))

// Stub the realtime sync hook used by useObjectStudioJobs — these tests
// exercise the polling fallback, not realtime delivery.
vi.mock("../../location-studio/use-jobs-realtime-sync", () => ({
  useJobsRealtimeSync: () => {},
}))

vi.mock("@/hooks/use-auth", () => ({
  getCachedUserId: () => "user-1",
}))

import { useObjectStudioJobs } from "../use-object-studio-jobs"
import { getJobStatusBatch } from "@/lib/api"

describe("useObjectStudioJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(getJobStatusBatch).mockResolvedValue({ jobs: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("trackJob adds to pending list", () => {
    const { result } = renderHook(() => useObjectStudioJobs([]))
    expect(result.current.tracked).toHaveLength(0)
    act(() => {
      result.current.trackJob({ jobId: "j1", assetType: "main", name: "candidate-0" })
    })
    expect(result.current.tracked).toEqual([{ jobId: "j1", assetType: "main", name: "candidate-0" }])
  })

  it("dedupes on duplicate trackJob (same jobId)", () => {
    const { result } = renderHook(() => useObjectStudioJobs([]))
    act(() => {
      result.current.trackJob({ jobId: "j1", assetType: "main", name: "first" })
      result.current.trackJob({ jobId: "j1", assetType: "main", name: "should-not-overwrite" })
    })
    expect(result.current.tracked).toHaveLength(1)
    expect(result.current.tracked[0].name).toBe("first")
  })

  it("does NOT poll when tracked is empty", async () => {
    renderHook(() => useObjectStudioJobs([]))
    await act(async () => {
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
    })
    expect(getJobStatusBatch).not.toHaveBeenCalled()
  })

  it("hydrates from initial pending jobs", () => {
    const { result } = renderHook(() =>
      useObjectStudioJobs([{ jobId: "seed-1", assetType: "main", name: "rehydrated" }]),
    )
    expect(result.current.tracked).toEqual([
      { jobId: "seed-1", assetType: "main", name: "rehydrated" },
    ])
  })

  it("polls getJobStatusBatch and fires onResolved on completion with imageUrl", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useObjectStudioJobs([]))
    act(() => {
      result.current.onResolved(onResolved)
      result.current.trackJob({ jobId: "j2", assetType: "main", name: "candidate-A" })
    })

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [
        {
          id: "j2",
          status: "completed",
          output_data: { imageUrl: "https://example.com/obj.png" },
        },
      ],
    })

    await act(async () => {
      // Advance past POLL_MS (10s) + max jitter (300ms padding to be safe).
      vi.advanceTimersByTime(10300)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onResolved).toHaveBeenCalledWith({
      jobId: "j2",
      assetType: "main",
      name: "candidate-A",
      url: "https://example.com/obj.png",
    })
    // Job is removed from tracked after resolution.
    expect(result.current.tracked).toHaveLength(0)
  })

  it("fires onFailed on status=failed and drops from tracked", async () => {
    const onFailed = vi.fn()
    const { result } = renderHook(() => useObjectStudioJobs([]))
    act(() => {
      result.current.onFailed(onFailed)
      result.current.trackJob({ jobId: "j3", assetType: "main", name: "doomed" })
    })

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [{ id: "j3", status: "failed", output_data: null }],
    })

    await act(async () => {
      vi.advanceTimersByTime(10300)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onFailed).toHaveBeenCalledWith("j3")
    expect(result.current.tracked).toHaveLength(0)
  })

  it("keeps pending jobs in tracked when status is still pending/running", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useObjectStudioJobs([]))
    act(() => {
      result.current.onResolved(onResolved)
      result.current.trackJob({ jobId: "j4", assetType: "main", name: "still-running" })
    })

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [{ id: "j4", status: "running", output_data: null }],
    })

    await act(async () => {
      vi.advanceTimersByTime(10300)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onResolved).not.toHaveBeenCalled()
    expect(result.current.tracked).toHaveLength(1)
  })

  it("falls back to videoUrl when imageUrl is absent (for motion-clip jobs)", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useObjectStudioJobs([]))
    act(() => {
      result.current.onResolved(onResolved)
      result.current.trackJob({ jobId: "j5", assetType: "motionClips", name: "spin" })
    })

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [
        {
          id: "j5",
          status: "completed",
          output_data: { videoUrl: "https://example.com/spin.mp4" },
        },
      ],
    })

    await act(async () => {
      vi.advanceTimersByTime(10300)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onResolved).toHaveBeenCalledWith({
      jobId: "j5",
      assetType: "motionClips",
      name: "spin",
      url: "https://example.com/spin.mp4",
    })
  })

  it("does NOT fire onResolved when completed but no URL in output_data", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useObjectStudioJobs([]))
    act(() => {
      result.current.onResolved(onResolved)
      result.current.trackJob({ jobId: "j6", assetType: "main", name: "no-url" })
    })

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [{ id: "j6", status: "completed", output_data: {} }],
    })

    await act(async () => {
      vi.advanceTimersByTime(10300)
      await Promise.resolve()
      await Promise.resolve()
    })

    // No URL → resolution incomplete; callback not fired and job stays tracked.
    expect(onResolved).not.toHaveBeenCalled()
    expect(result.current.tracked).toHaveLength(1)
  })

  it("ignores status events for jobs not currently tracked", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useObjectStudioJobs([]))
    act(() => {
      result.current.onResolved(onResolved)
      result.current.trackJob({ jobId: "j7", assetType: "main", name: "tracked" })
    })

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [
        // Unrelated job — should be ignored.
        { id: "untracked-99", status: "completed", output_data: { imageUrl: "https://x" } },
      ],
    })

    await act(async () => {
      vi.advanceTimersByTime(10300)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onResolved).not.toHaveBeenCalled()
    expect(result.current.tracked).toHaveLength(1) // tracked job unchanged
  })

  it("supports swapping onResolved between renders (callback ref pattern)", async () => {
    const first = vi.fn()
    const second = vi.fn()

    const { result, rerender } = renderHook(() => useObjectStudioJobs([]))
    act(() => {
      result.current.onResolved(first)
      result.current.trackJob({ jobId: "j8", assetType: "main", name: "first-cb" })
    })

    // Swap callback before resolution arrives.
    act(() => {
      result.current.onResolved(second)
    })
    rerender()

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [{ id: "j8", status: "completed", output_data: { imageUrl: "https://x.png" } }],
    })

    await act(async () => {
      vi.advanceTimersByTime(10300)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })
})
