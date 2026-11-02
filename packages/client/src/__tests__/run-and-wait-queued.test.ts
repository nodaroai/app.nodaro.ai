/**
 * A job waiting for a free concurrency slot (`queued`) does not use up
 * `runAndWait`'s `maxMs`: the clock starts at the first poll, as it always
 * has, and is extended by the time a poll saw the job `queued`. Every other
 * status (`pending` included) counts as before. Status reads carry `queue`.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { createClient, StaticTokenAuth, JobTimeoutError } from "../index.js"
import type { JobQueueInfo, JobStatus, JobStatusResult } from "../index.js"

type FetchMock = ReturnType<typeof vi.fn> & typeof fetch

const ok = <T>(body: T) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)

const QUEUE: JobQueueInfo = {
  lane: "provider",
  position: 2,
  limit: 4,
  running: 4,
  reason: "user_lane",
  waitedSeconds: 37,
  upgradeHint: "plan",
}

/**
 * `POST /v1/<type>` answers `{ jobId: "job-1" }`; each status read answers
 * `statusAt(Date.now())` — the job's status as a function of (fake) time.
 */
function runThenTimeline(statusAt: (now: number) => Partial<JobStatusResult>): FetchMock {
  return vi.fn((_url: string, init: { method: string }) => {
    if (init.method === "POST") return ok({ jobId: "job-1" })
    return ok({ data: { id: "job-1", progress: 0, ...statusAt(Date.now()) } })
  }) as unknown as FetchMock
}

const client = (fetchMock: FetchMock) =>
  createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t"), fetch: fetchMock })

afterEach(() => {
  vi.useRealTimers()
})

describe("runAndWait and a job waiting for a slot", () => {
  it("runAndWait does not time out while the job is queued", async () => {
    vi.useFakeTimers()
    const start = Date.now()
    // Queued for five times maxMs, then runs and completes.
    const fetchMock = runThenTimeline((now) => {
      const t = now - start
      if (t < 15_000) return { status: "queued" as JobStatus, queue: QUEUE }
      if (t < 17_000) return { status: "processing" as JobStatus }
      return { status: "completed" as JobStatus, output_data: { imageUrl: "https://x/y.png" } }
    })
    const promise = client(fetchMock)
      .nodes.runAndWait("generate-image", {}, { pollMs: 1000, maxMs: 3000 })
      .catch((e) => e)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await promise).toEqual({ imageUrl: "https://x/y.png" })
  })

  it("a job stuck in pending still times out at maxMs, as before", async () => {
    vi.useFakeTimers()
    const start = Date.now()
    const fetchMock = runThenTimeline(() => ({ status: "pending" as JobStatus }))
    let settledAt: number | null = null
    const promise = client(fetchMock)
      .nodes.runAndWait("generate-video", {}, { pollMs: 1000, maxMs: 3000 })
      .catch((e) => {
        settledAt = Date.now() - start
        return e
      })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await promise).toBeInstanceOf(JobTimeoutError)
    // Deadline 3 s after the first poll; the poll at 4 s sees it passed.
    expect(settledAt).toBe(4_000)
  })

  it("runAndWait times out maxMs after the queued stretch", async () => {
    vi.useFakeTimers()
    const start = Date.now()
    // Queued for 10 s, then processing forever.
    const fetchMock = runThenTimeline((now) =>
      now - start < 10_000 ? { status: "queued" as JobStatus, queue: QUEUE } : { status: "processing" as JobStatus },
    )
    let settledAt: number | null = null
    const promise = client(fetchMock)
      .nodes.runAndWait("generate-video", {}, { pollMs: 1000, maxMs: 3000 })
      .catch((e) => {
        settledAt = Date.now() - start
        return e
      })
    // Well past maxMs from submit, but the queued stretch did not count.
    await vi.advanceTimersByTimeAsync(12_000)
    expect(settledAt).toBeNull()
    await vi.advanceTimersByTimeAsync(10_000)
    const err = await promise
    expect(err).toBeInstanceOf(JobTimeoutError)
    expect(err).toMatchObject({ code: "job_timeout", jobId: "job-1", timeoutMs: 3000 })
    // The reads at 1–9 s saw it queued: 9 s credited, so the deadline is
    // 3 s + 9 s = 12 s, and the poll at 13 s sees it passed.
    expect(settledAt).toBe(13_000)
  })

  it("pending time around a queued stretch still counts", async () => {
    vi.useFakeTimers()
    const start = Date.now()
    // Pending 2 s, queued until 10 s, then pending forever (never picked up).
    const fetchMock = runThenTimeline((now) => {
      const t = now - start
      if (t >= 2_000 && t < 10_000) return { status: "queued" as JobStatus, queue: QUEUE }
      return { status: "pending" as JobStatus }
    })
    let settledAt: number | null = null
    const promise = client(fetchMock)
      .nodes.runAndWait("generate-video", {}, { pollMs: 1000, maxMs: 3000 })
      .catch((e) => {
        settledAt = Date.now() - start
        return e
      })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await promise).toBeInstanceOf(JobTimeoutError)
    // Reads at 2–9 s saw it queued: 8 s credited, deadline 11 s, timed out at 12 s.
    expect(settledAt).toBe(12_000)
  })

  it("onProgress sees the queue of each queued tick", async () => {
    vi.useFakeTimers()
    const start = Date.now()
    const fetchMock = runThenTimeline((now) =>
      now - start < 2_000
        ? { status: "queued" as JobStatus, queue: QUEUE }
        : { status: "completed" as JobStatus, output_data: {} },
    )
    const seen: JobStatusResult[] = []
    const promise = client(fetchMock).nodes.runAndWait("generate-video", {}, { pollMs: 1000, onProgress: (s) => seen.push(s) })
    await vi.advanceTimersByTimeAsync(5_000)
    await promise
    expect(seen[0]).toMatchObject({ status: "queued", queue: QUEUE })
    expect(seen.at(-1)?.queue).toBeUndefined()
  })
})

describe("jobs.getStatus", () => {
  it("getStatus exposes queue", async () => {
    const fetchMock = vi.fn(() => ok({ data: { id: "job-1", status: "queued", queue: QUEUE } })) as unknown as FetchMock
    const { data } = await client(fetchMock).jobs.getStatus("job-1")
    expect(data.status).toBe("queued")
    expect(data.queue).toEqual(QUEUE)
  })

  it("jobs.get, executions.get and pipelines.get expose queue", async () => {
    const RUN_QUEUE: JobQueueInfo = { ...QUEUE, lane: "run" }
    const fetchMock = vi.fn((url: string) => {
      if (/workflow-executions/.test(url)) return ok({ data: { id: "exec-1", status: "pending", queue: RUN_QUEUE } })
      if (/pipelines/.test(url)) return ok({ id: "pipe-1", status: "queued", queue: RUN_QUEUE })
      return ok({ data: { id: "job-1", status: "queued", queue: QUEUE } })
    }) as unknown as FetchMock
    const c = client(fetchMock)
    expect((await c.jobs.get("job-1")).data.queue).toEqual(QUEUE)
    expect((await c.executions.get("exec-1")).data.queue).toEqual(RUN_QUEUE)
    const pipeline = await c.pipelines.get("pipe-1")
    expect(pipeline.status).toBe("queued")
    expect(pipeline.queue).toEqual(RUN_QUEUE)
  })
})
