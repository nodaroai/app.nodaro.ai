import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCharacterStudioJobs } from "../use-character-studio-jobs"

const getJobStatusLean = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({
  getJobStatusLean,
  cancelJob: vi.fn(),
}))

describe("useCharacterStudioJobs — boards meta side-channel", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getJobStatusLean.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("carries meta from begin() through settle() to onResolved on completion", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useCharacterStudioJobs(onResolved, vi.fn()))
    const meta = { sourceImages: ["https://a/1.png", "https://a/2.png"] }

    let tempId = ""
    act(() => {
      tempId = result.current.begin("boards", "Evening gown", meta)
    })
    act(() => {
      result.current.settle(tempId, "job-1")
    })

    getJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "https://r2/board.png" },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })

    expect(onResolved).toHaveBeenCalledWith({
      assetType: "boards",
      name: "Evening gown",
      url: "https://r2/board.png",
      meta,
    })
  })

  it("keeps meta on the failed map for Retry", async () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    act(() => {
      result.current.track("job-2", "boards", "Beach run", { sourceImages: ["https://a/3.png"] })
    })
    getJobStatusLean.mockResolvedValue({ status: "failed", error_message: "boom" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(result.current.failed.get("job-2")?.meta).toEqual({ sourceImages: ["https://a/3.png"] })
  })
})
