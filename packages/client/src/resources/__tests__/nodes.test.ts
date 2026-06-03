import { describe, it, expect, vi, afterEach } from "vitest"
import {
  createClient,
  StaticTokenAuth,
  NotFoundError,
  InsufficientCreditsError,
  JobFailedError,
  JobTimeoutError,
  JobAbortedError,
} from "../../index.js"
import type { JobStatus, JobStatusResult } from "../jobs.js"

function mockOk<T>(body: T) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function mockErr(status: number, body: unknown) {
  return Promise.resolve({ ok: false, status, json: async () => body } as unknown as Response)
}

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch

/** Wrap a (url, init) handler in a vi.fn typed as the client's `fetch` override. */
function makeFetch(
  handler: (url: string, init: { method: string; body?: string }) => Promise<Response>,
): FetchMock {
  return vi.fn(handler) as unknown as FetchMock
}

/** Build a fetch mock that answers `POST /v1/<type>` with `runBody`, then each
 * `GET /v1/jobs/:id/status` with the next queued status payload in order. */
function runThenStatuses(
  runBody: unknown,
  statuses: Partial<JobStatusResult>[],
): FetchMock {
  let statusIdx = 0
  return vi.fn((url: string, init: { method: string }) => {
    if (init.method === "POST") return mockOk(runBody)
    // GET status — return the next status, repeating the last one if exhausted.
    const s = statuses[Math.min(statusIdx, statuses.length - 1)]
    statusIdx += 1
    return mockOk({ data: { id: "job-1", progress: 0, ...s } })
  }) as unknown as FetchMock
}

function client(fetchMock: FetchMock) {
  return createClient({
    baseUrl: "https://api.example.com",
    auth: new StaticTokenAuth("t"),
    fetch: fetchMock,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("nodes resource", () => {
  it("list GETs /v1/nodes", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(mockOk({ data: [] }))
    const c = client(fetchMock)
    await c.nodes.list()
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/nodes")
    expect(fetchMock.mock.calls[0][1].method).toBe("GET")
  })

  it("get throws NotFoundError when type is unknown", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(
      mockErr(404, { error: { code: "not_found", message: "Node type not found" } }),
    )
    const c = client(fetchMock)
    await expect(c.nodes.get("does-not-exist")).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe("nodes.runAndWait", () => {
  it("polls running → completed and resolves typed output_data", async () => {
    vi.useFakeTimers()
    const fetchMock = runThenStatuses({ jobId: "job-1" }, [
      { status: "running" as JobStatus },
      { status: "completed", output_data: { videoUrl: "https://r2/out.mp4" } },
    ])
    const c = client(fetchMock)

    const promise = c.nodes.runAndWait("generate-video", { prompt: "x" }, { pollMs: 2000 })
    await vi.advanceTimersByTimeAsync(2500) // flush run + first poll + sleep + second poll
    const output = await promise

    expect(output).toEqual({ videoUrl: "https://r2/out.mp4" })
    // 1 POST (run) + 2 GET (status polls)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/v1/generate-video")
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/v1/jobs/job-1/status")
  })

  it("resolves immediately when the first poll is already completed (one GET)", async () => {
    const fetchMock = runThenStatuses({ jobId: "job-1" }, [
      { status: "completed", output_data: { imageUrl: "https://r2/a.png" } },
    ])
    const c = client(fetchMock)
    const output = await c.nodes.runAndWait("generate-image", {})
    expect(output).toEqual({ imageUrl: "https://r2/a.png" })
    expect(fetchMock).toHaveBeenCalledTimes(2) // POST + 1 GET, no sleep needed
  })

  it("calls onProgress on each poll", async () => {
    vi.useFakeTimers()
    const fetchMock = runThenStatuses({ jobId: "job-1" }, [
      { status: "queued" as JobStatus, progress: 0 },
      { status: "processing" as JobStatus, progress: 50 },
      { status: "completed", progress: 100, output_data: {} },
    ])
    const c = client(fetchMock)
    const onProgress = vi.fn()
    const promise = c.nodes.runAndWait("generate-video", {}, { pollMs: 1000, onProgress })
    await vi.advanceTimersByTimeAsync(2500)
    await promise
    expect(onProgress).toHaveBeenCalledTimes(3)
    expect(onProgress.mock.calls.map((c) => (c[0] as JobStatusResult).status)).toEqual([
      "queued",
      "processing",
      "completed",
    ])
  })

  it("throws JobFailedError on terminal failed (carrying message + jobId)", async () => {
    vi.useFakeTimers()
    const fetchMock = runThenStatuses({ jobId: "job-7" }, [
      { status: "processing" as JobStatus },
      { id: "job-7", status: "failed", error_message: "provider exploded" },
    ])
    const c = client(fetchMock)
    const promise = c.nodes.runAndWait("generate-video", {}, { pollMs: 1000 }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(1500)
    const err = await promise
    expect(err).toBeInstanceOf(JobFailedError)
    expect(err).toMatchObject({
      name: "JobFailedError",
      message: "provider exploded",
      code: "job_failed",
      jobStatus: "failed",
      jobId: "job-7",
    })
  })

  it("throws JobFailedError on terminal cancelled", async () => {
    const fetchMock = runThenStatuses({ jobId: "job-1" }, [
      { status: "cancelled", error_message: null },
    ])
    const c = client(fetchMock)
    await expect(c.nodes.runAndWait("generate-video", {})).rejects.toMatchObject({
      name: "JobFailedError",
      jobStatus: "cancelled",
    })
  })

  it("throws JobFailedError when run returns no jobId (inline/changed route)", async () => {
    const fetchMock = makeFetch(() => mockOk({ text: "synchronous result, no jobId" }))
    const c = client(fetchMock)
    await expect(c.nodes.runAndWait("combine-text", {})).rejects.toBeInstanceOf(JobFailedError)
    expect(fetchMock).toHaveBeenCalledTimes(1) // never polled
  })

  it("surfaces InsufficientCreditsError from run() before any poll", async () => {
    const fetchMock = makeFetch(() =>
      mockErr(402, { error: { code: "insufficient_credits", message: "broke", required: 10, available: 2 } }),
    )
    const c = client(fetchMock)
    await expect(c.nodes.runAndWait("generate-video", {})).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1) // run failed, never polled status
  })

  it("rejects with JobAbortedError when the signal is already aborted (never runs)", async () => {
    const fetchMock = makeFetch(() => mockOk({ jobId: "job-1" }))
    const c = client(fetchMock)
    const ac = new AbortController()
    ac.abort()
    await expect(
      c.nodes.runAndWait("generate-video", {}, { signal: ac.signal }),
    ).rejects.toBeInstanceOf(JobAbortedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("aborts mid-poll: rejects with JobAbortedError and stops polling", async () => {
    vi.useFakeTimers()
    const ac = new AbortController()
    const fetchMock = runThenStatuses({ jobId: "job-1" }, [
      { status: "running" as JobStatus },
      { status: "running" as JobStatus },
      { status: "running" as JobStatus },
    ])
    const c = client(fetchMock)
    const promise = c.nodes.runAndWait("generate-video", {}, { pollMs: 2000, signal: ac.signal })
    // Let run + first poll happen, then enter the sleep.
    await vi.advanceTimersByTimeAsync(100)
    const callsBeforeAbort = fetchMock.mock.calls.length
    ac.abort() // fires during the sleep → rejects, no further polls
    await expect(promise).rejects.toBeInstanceOf(JobAbortedError)
    // Advancing further must not trigger any more fetches.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchMock.mock.calls.length).toBe(callsBeforeAbort)
  })

  it("throws JobTimeoutError once maxMs is exceeded without a terminal status", async () => {
    vi.useFakeTimers()
    const fetchMock = runThenStatuses({ jobId: "job-1" }, [
      { status: "running" as JobStatus }, // never terminal
    ])
    const c = client(fetchMock)
    const promise = c.nodes
      .runAndWait("generate-video", {}, { pollMs: 1000, maxMs: 3000 })
      .catch((e) => e)
    await vi.advanceTimersByTimeAsync(6000)
    const err = await promise
    expect(err).toBeInstanceOf(JobTimeoutError)
    expect(err).toMatchObject({
      name: "JobTimeoutError",
      code: "job_timeout",
      jobId: "job-1",
      timeoutMs: 3000,
    })
  })

  it("defaults: pollMs 2000 and maxMs ~15min", async () => {
    vi.useFakeTimers()
    // Stays running across many polls, never terminal — should time out at 15min.
    const fetchMock = runThenStatuses({ jobId: "job-1" }, [{ status: "running" as JobStatus }])
    const c = client(fetchMock)
    const promise = c.nodes.runAndWait("generate-video", {})
    const assertion = expect(promise).rejects.toBeInstanceOf(JobTimeoutError)
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 2000)
    await assertion
    // ~15min / 2s poll ≈ 450 polls; assert it polled far more than a couple times
    // (proves the 2000ms default interval, not a tight loop).
    expect(fetchMock.mock.calls.filter((c) => c[1].method === "GET").length).toBeGreaterThan(400)
  })
})

describe("nodes.runMany", () => {
  it("fans out N runs and resolves an array of { jobId, output } in order", async () => {
    vi.useFakeTimers()
    // Each candidate: POST then a single completed status. Distinguish by body.
    let n = 0
    const fetchMock = makeFetch((url, init) => {
      if (init.method === "POST") {
        n += 1
        return mockOk({ jobId: `job-${n}` })
      }
      // status GET — derive index from the url's job id
      const m = /job-(\d+)/.exec(url)
      const i = m ? m[1] : "?"
      return mockOk({
        data: { id: `job-${i}`, status: "completed", output_data: { imageUrl: `https://r2/${i}.png` } },
      })
    })
    const c = client(fetchMock)
    const promise = c.nodes.runMany("generate-image", [{ seed: 1 }, { seed: 2 }, { seed: 3 }])
    await vi.advanceTimersByTimeAsync(2500)
    const results = await promise

    expect(results).toHaveLength(3)
    expect(results.map((r) => r.jobId)).toEqual(["job-1", "job-2", "job-3"])
    expect(results.map((r) => (r.output as { imageUrl: string }).imageUrl)).toEqual([
      "https://r2/1.png",
      "https://r2/2.png",
      "https://r2/3.png",
    ])
    expect(fetchMock.mock.calls.filter((c) => c[1].method === "POST")).toHaveLength(3)
  })

  it("rejects if any candidate fails", async () => {
    vi.useFakeTimers()
    let n = 0
    const fetchMock = makeFetch((url, init) => {
      if (init.method === "POST") {
        n += 1
        return mockOk({ jobId: `job-${n}` })
      }
      // job-2 fails, others complete
      if (/job-2/.test(url)) {
        return mockOk({ data: { id: "job-2", status: "failed", error_message: "nope" } })
      }
      return mockOk({ data: { id: "j", status: "completed", output_data: {} } })
    })
    const c = client(fetchMock)
    const promise = c.nodes.runMany("generate-image", [{}, {}, {}])
    const assertion = expect(promise).rejects.toBeInstanceOf(JobFailedError)
    await vi.advanceTimersByTimeAsync(2500)
    await assertion
  })

  it("rejects with JobAbortedError when signal already aborted (no runs)", async () => {
    const fetchMock = makeFetch(() => mockOk({ jobId: "job-1" }))
    const c = client(fetchMock)
    const ac = new AbortController()
    ac.abort()
    await expect(
      c.nodes.runMany("generate-image", [{}, {}], { signal: ac.signal }),
    ).rejects.toBeInstanceOf(JobAbortedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
