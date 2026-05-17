import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"

// Hoisted mock — must precede the SUT import.
vi.mock("@/lib/api", () => ({
  getJobStatus: vi.fn(),
  cancelJob: vi.fn().mockResolvedValue({ success: true }),
}))

import { useCharacterStudioJobs } from "../use-character-studio-jobs"
import { getJobStatus } from "@/lib/api"

describe("useCharacterStudioJobs.trackAndWait", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves with the image URL when the job completes (bodyAngles → imageUrl)", async () => {
    const onResolved = vi.fn()
    const onFailed = vi.fn()
    const { result } = renderHook(() => useCharacterStudioJobs(onResolved, onFailed))

    let resolved: string | undefined
    let pendingPromise!: Promise<string>
    act(() => {
      pendingPromise = result.current.trackAndWait("job-1", "bodyAngles", "front")
      void pendingPromise.then((u) => { resolved = u })
    })

    // Spinner card visible.
    expect(result.current.pending.has("job-1")).toBe(true)

    // Step 1 poll tick: backend says completed with an image URL.
    vi.mocked(getJobStatus).mockResolvedValueOnce({
      id: "job-1",
      status: "completed",
      output_data: { imageUrl: "https://example.com/body-front.png" },
      input_data: {},
      created_at: new Date().toISOString(),
    } as never)

    await act(async () => {
      vi.advanceTimersByTime(2000) // POLL_MS
      // Flush all pending micro-tasks. vi.advanceTimers doesn't await the async callback inside setInterval.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    await pendingPromise
    expect(resolved).toBe("https://example.com/body-front.png")
    // onResolved was ALSO called so the staged-array merge happens in the modal.
    expect(onResolved).toHaveBeenCalledWith({
      assetType: "bodyAngles",
      name: "front",
      url: "https://example.com/body-front.png",
    })
    // Spinner card removed.
    expect(result.current.pending.has("job-1")).toBe(false)
  })

  it("returns the video URL for motion-type jobs (videoUrl, not imageUrl)", async () => {
    const onResolved = vi.fn()
    const onFailed = vi.fn()
    const { result } = renderHook(() => useCharacterStudioJobs(onResolved, onFailed))

    let pendingPromise!: Promise<string>
    act(() => {
      pendingPromise = result.current.trackAndWait("motion-1", "motions", "wave")
    })

    vi.mocked(getJobStatus).mockResolvedValueOnce({
      id: "motion-1",
      status: "completed",
      output_data: { videoUrl: "https://example.com/wave.mp4" },
      input_data: {},
      created_at: new Date().toISOString(),
    } as never)

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    await expect(pendingPromise).resolves.toBe("https://example.com/wave.mp4")
  })

  it("rejects when the backend reports status=failed (auto-chain must NOT proceed)", async () => {
    const onResolved = vi.fn()
    const onFailed = vi.fn()
    const { result } = renderHook(() => useCharacterStudioJobs(onResolved, onFailed))

    let pendingPromise!: Promise<string>
    type Outcome = { ok: boolean; err?: Error }
    const outcomeRef: { current: Outcome | null } = { current: null }
    act(() => {
      pendingPromise = result.current.trackAndWait("job-2", "bodyAngles", "front")
      // Attach the catch synchronously so the rejection is observed even
      // before the `await expect(...).rejects` below pulls it in.
      void pendingPromise.then(
        () => { outcomeRef.current = { ok: true } },
        (e: Error) => { outcomeRef.current = { ok: false, err: e } },
      )
    })

    vi.mocked(getJobStatus).mockResolvedValueOnce({
      id: "job-2",
      status: "failed",
      error_message: "provider blew up",
      input_data: {},
      created_at: new Date().toISOString(),
    } as never)

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(outcomeRef.current).toEqual({ ok: false, err: expect.any(Error) })
    expect(outcomeRef.current?.err?.message).toBe("provider blew up")
    expect(onFailed).toHaveBeenCalledWith("job-2", "bodyAngles")
    // Spinner card removed even on failure.
    expect(result.current.pending.has("job-2")).toBe(false)
  })

  it("rejects when the job is cancelled (and removes the spinner)", async () => {
    const onResolved = vi.fn()
    const onFailed = vi.fn()
    const { result } = renderHook(() => useCharacterStudioJobs(onResolved, onFailed))

    type Outcome = { ok: boolean; err?: Error }
    const outcomeRef: { current: Outcome | null } = { current: null }
    act(() => {
      const p = result.current.trackAndWait("job-3", "bodyAngles", "front")
      void p.then(
        () => { outcomeRef.current = { ok: true } },
        (e: Error) => { outcomeRef.current = { ok: false, err: e } },
      )
    })

    await act(async () => {
      await result.current.cancel("job-3")
    })

    expect(outcomeRef.current?.ok).toBe(false)
    expect(outcomeRef.current?.err?.message).toBe("cancelled")
    expect(result.current.pending.has("job-3")).toBe(false)
    // onFailed is NOT called on cancel — cancellations disappear silently.
    expect(onFailed).not.toHaveBeenCalled()
  })

  it("rejects on unmount so the chain doesn't hang when the studio closes mid-gen", async () => {
    const onResolved = vi.fn()
    const onFailed = vi.fn()
    const { result, unmount } = renderHook(() => useCharacterStudioJobs(onResolved, onFailed))

    type Outcome = { ok: boolean; err?: Error }
    const outcomeRef: { current: Outcome | null } = { current: null }
    act(() => {
      const p = result.current.trackAndWait("job-4", "bodyAngles", "front")
      void p.then(
        () => { outcomeRef.current = { ok: true } },
        (e: Error) => { outcomeRef.current = { ok: false, err: e } },
      )
    })

    act(() => {
      unmount()
    })

    // Microtask flush so the rejected promise's `.then` runs.
    await Promise.resolve()

    expect(outcomeRef.current?.ok).toBe(false)
    expect(outcomeRef.current?.err?.message).toBe("studio closed")
  })
})
