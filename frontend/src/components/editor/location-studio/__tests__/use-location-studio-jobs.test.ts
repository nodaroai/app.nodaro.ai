import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"

// Hoisted mock — must precede the SUT import.
vi.mock("@/lib/api", () => ({
  getJobStatusBatch: vi.fn(),
}))

import { useLocationStudioJobs } from "../use-location-studio-jobs"
import { getJobStatusBatch } from "@/lib/api"

describe("useLocationStudioJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(getJobStatusBatch).mockResolvedValue({ jobs: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("trackJob adds to pending list", () => {
    const { result } = renderHook(() => useLocationStudioJobs([]))
    expect(result.current.tracked).toHaveLength(0)
    act(() => {
      result.current.trackJob({ jobId: "j1", assetType: "main", name: "candidate-0" })
    })
    expect(result.current.tracked).toEqual([{ jobId: "j1", assetType: "main", name: "candidate-0" }])
  })

  it("dedupes on duplicate trackJob (same jobId)", () => {
    const { result } = renderHook(() => useLocationStudioJobs([]))
    act(() => {
      result.current.trackJob({ jobId: "j1", assetType: "main", name: "first" })
      result.current.trackJob({ jobId: "j1", assetType: "main", name: "should-not-overwrite" })
    })
    expect(result.current.tracked).toHaveLength(1)
    expect(result.current.tracked[0].name).toBe("first")
  })

  it("does NOT poll when tracked is empty", async () => {
    renderHook(() => useLocationStudioJobs([]))
    await act(async () => {
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
    })
    expect(getJobStatusBatch).not.toHaveBeenCalled()
  })

  it("hydrates from initial pending jobs", () => {
    const { result } = renderHook(() =>
      useLocationStudioJobs([{ jobId: "seed-1", assetType: "main", name: "rehydrated" }]),
    )
    expect(result.current.tracked).toEqual([{ jobId: "seed-1", assetType: "main", name: "rehydrated" }])
  })

  it("polls getJobStatusBatch and fires onResolved on completion with imageUrl", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useLocationStudioJobs([]))
    act(() => {
      result.current.onResolved(onResolved)
      result.current.trackJob({ jobId: "j2", assetType: "main", name: "candidate-A" })
    })

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [
        {
          id: "j2",
          status: "completed",
          output_data: { imageUrl: "https://example.com/loc.png" },
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
      url: "https://example.com/loc.png",
    })
    // Job is removed from tracked after resolution.
    expect(result.current.tracked).toHaveLength(0)
  })

  it("fires onFailed on status=failed and drops from tracked", async () => {
    const onFailed = vi.fn()
    const { result } = renderHook(() => useLocationStudioJobs([]))
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
    const { result } = renderHook(() => useLocationStudioJobs([]))
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

  it("falls back to videoUrl when imageUrl is absent (for video-asset jobs)", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useLocationStudioJobs([]))
    act(() => {
      result.current.onResolved(onResolved)
      result.current.trackJob({ jobId: "j5", assetType: "atmosphereMotions", name: "rain" })
    })

    vi.mocked(getJobStatusBatch).mockResolvedValueOnce({
      jobs: [
        {
          id: "j5",
          status: "completed",
          output_data: { videoUrl: "https://example.com/rain.mp4" },
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
      assetType: "atmosphereMotions",
      name: "rain",
      url: "https://example.com/rain.mp4",
    })
  })
})
