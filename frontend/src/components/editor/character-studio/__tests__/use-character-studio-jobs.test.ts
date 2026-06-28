import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"

// Hoisted mock — must precede the SUT import.
vi.mock("@/lib/api", () => ({
  getJobStatusLean: vi.fn(),
  cancelJob: vi.fn().mockResolvedValue({ success: true }),
}))

import { useCharacterStudioJobs } from "../use-character-studio-jobs"
import { getJobStatusLean, cancelJob } from "@/lib/api"

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
    vi.mocked(getJobStatusLean).mockResolvedValueOnce({
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

    vi.mocked(getJobStatusLean).mockResolvedValueOnce({
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

    vi.mocked(getJobStatusLean).mockResolvedValueOnce({
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

describe("useCharacterStudioJobs failed surfacing (failed/dismissFailed)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("surfaces a failed job in `failed` (name + assetType) and removes the spinner", async () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    act(() => {
      result.current.track("job-f", "expressions", "smile")
    })
    vi.mocked(getJobStatusLean).mockResolvedValueOnce({
      id: "job-f",
      status: "failed",
      error_message: "boom",
      input_data: {},
      created_at: new Date().toISOString(),
    } as never)

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    // Spinner gone, but a dismissible failed entry remains for the tab to render.
    expect(result.current.pending.has("job-f")).toBe(false)
    expect(result.current.failed.get("job-f")).toEqual({ assetType: "expressions", name: "smile" })

    // dismissFailed (Retry or ✕) clears it.
    act(() => {
      result.current.dismissFailed("job-f")
    })
    expect(result.current.failed.has("job-f")).toBe(false)
  })

  it("does NOT add a `failed` entry for a cancelled job (cancellations stay silent)", async () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    act(() => {
      result.current.track("job-c", "poses", "standing")
    })
    vi.mocked(getJobStatusLean).mockResolvedValueOnce({
      id: "job-c",
      status: "cancelled",
      input_data: {},
      created_at: new Date().toISOString(),
    } as never)

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })

    expect(result.current.pending.has("job-c")).toBe(false)
    expect(result.current.failed.size).toBe(0)
  })
})

describe("useCharacterStudioJobs optimistic lifecycle (begin/settle/abort)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("begin() synchronously adds an optimistic pending entry (instant spinner card)", () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    let tempId!: string
    act(() => {
      tempId = result.current.begin("expressions", "smile")
    })
    expect(result.current.pending.has(tempId)).toBe(true)
    const entry = result.current.pending.get(tempId)
    expect(entry).toMatchObject({ assetType: "expressions", name: "smile", optimistic: true })
  })

  it("begin() returns unique ids so two quick clicks both show a card", () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    let a!: string, b!: string
    act(() => {
      a = result.current.begin("poses", "standing")
      b = result.current.begin("poses", "walking")
    })
    expect(a).not.toBe(b)
    expect(result.current.pending.size).toBe(2)
  })

  it("does NOT poll the backend for an optimistic entry (no real jobId yet)", async () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    act(() => {
      result.current.begin("expressions", "smile")
    })
    await act(async () => {
      vi.advanceTimersByTime(2000) // POLL_MS
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(getJobStatusLean).not.toHaveBeenCalled()
  })

  it("settle() swaps the optimistic temp id for the real jobId (now pollable)", async () => {
    const onResolved = vi.fn()
    const { result } = renderHook(() => useCharacterStudioJobs(onResolved, vi.fn()))
    let tempId!: string
    act(() => {
      tempId = result.current.begin("expressions", "smile")
    })
    act(() => {
      result.current.settle(tempId, "job-real")
    })
    expect(result.current.pending.has(tempId)).toBe(false)
    expect(result.current.pending.has("job-real")).toBe(true)
    expect(result.current.pending.get("job-real")?.optimistic).toBeFalsy()

    // The real entry is now polled to completion like any tracked job.
    vi.mocked(getJobStatusLean).mockResolvedValueOnce({
      id: "job-real",
      status: "completed",
      output_data: { imageUrl: "https://example.com/smile.png" },
      input_data: {},
      created_at: new Date().toISOString(),
    } as never)
    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onResolved).toHaveBeenCalledWith({ assetType: "expressions", name: "smile", url: "https://example.com/smile.png" })
    expect(result.current.pending.has("job-real")).toBe(false)
  })

  it("abort() removes the optimistic entry (request failed before a jobId existed)", () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    let tempId!: string
    act(() => {
      tempId = result.current.begin("expressions", "smile")
    })
    act(() => {
      result.current.abort(tempId)
    })
    expect(result.current.pending.has(tempId)).toBe(false)
    expect(result.current.pending.size).toBe(0)
  })

  it("settle() after the entry was aborted/cancelled is a no-op (doesn't resurrect)", () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    let tempId!: string
    act(() => {
      tempId = result.current.begin("expressions", "smile")
    })
    act(() => {
      result.current.abort(tempId)
    })
    act(() => {
      result.current.settle(tempId, "job-real")
    })
    expect(result.current.pending.has("job-real")).toBe(false)
    expect(result.current.pending.size).toBe(0)
  })

  it("cancel() on an optimistic entry removes the card without calling the backend", async () => {
    const { result } = renderHook(() => useCharacterStudioJobs(vi.fn(), vi.fn()))
    let tempId!: string
    act(() => {
      tempId = result.current.begin("expressions", "smile")
    })
    await act(async () => {
      await result.current.cancel(tempId)
    })
    expect(result.current.pending.has(tempId)).toBe(false)
    expect(cancelJob).not.toHaveBeenCalled()
  })
})
