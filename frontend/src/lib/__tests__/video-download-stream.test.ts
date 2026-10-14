// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
// The stream goes STRAIGHT to the API (a buffering dev proxy would deliver the
// whole progress at the end), so its base is the runtime API url, not "".
vi.mock("@/lib/runtime-config", () => ({ runtimeApiUrl: () => "https://api.test" }))

import { followVideoDownload } from "../video-download-stream"

/** A streamed SSE response built from ready-made frames. */
function sse(frames: readonly string[], status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } })
}

const frame = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n\n`

/** A fetch that answers each call with the next prepared response (or throws it). */
function fetchSequence(answers: ReadonlyArray<Response | Error>) {
  let i = 0
  return vi.fn(async (_input: string, _init?: RequestInit) => {
    const answer = answers[Math.min(i, answers.length - 1)]
    i++
    if (answer instanceof Error) throw answer
    return answer
  })
}

const FAST = { reconnectDelayMs: 0 }

describe("followVideoDownload", () => {
  it("asks the progress endpoint for that download", async () => {
    const fetchImpl = fetchSequence([sse([frame({ phase: "completed", percent: 100, videoUrl: "v.mp4" })])])
    await followVideoDownload("dl-42", { onProgress: vi.fn(), fetchImpl, ...FAST })
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.test/v1/download-video/progress/dl-42")
  })

  it("relays progress and resolves with the stored file", async () => {
    const onProgress = vi.fn()
    const fetchImpl = fetchSequence([
      sse([
        frame({ phase: "downloading", percent: 12 }),
        frame({ phase: "processing", percent: 90 }),
        frame({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4", thumbnailUrl: "https://cdn/t.jpg" }),
      ]),
    ])
    const outcome = await followVideoDownload("dl-1", { onProgress, fetchImpl, ...FAST })
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
      { phase: "downloading", percent: 12 },
      { phase: "processing", percent: 90 },
    ])
    expect(outcome).toEqual({ status: "completed", videoUrl: "https://cdn/v.mp4", thumbnailUrl: "https://cdn/t.jpg" })
  })

  it("reads a frame that arrives split across two network chunks", async () => {
    const whole = frame({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4" })
    const fetchImpl = fetchSequence([sse([whole.slice(0, 20), whole.slice(20)])])
    expect(await followVideoDownload("dl-1", { onProgress: vi.fn(), fetchImpl, ...FAST })).toEqual({
      status: "completed",
      videoUrl: "https://cdn/v.mp4",
    })
  })

  it("resolves failed with the server's own words", async () => {
    const fetchImpl = fetchSequence([sse([frame({ phase: "failed", percent: 0, error: "Private video" })])])
    expect(await followVideoDownload("dl-1", { onProgress: vi.fn(), fetchImpl, ...FAST })).toEqual({
      status: "failed",
      error: "Private video",
    })
  })

  it("is one-shot — a frame buffered after the terminal one is never relayed", async () => {
    const onProgress = vi.fn()
    const fetchImpl = fetchSequence([
      sse([
        frame({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4" }) +
          frame({ phase: "downloading", percent: 5 }),
      ]),
    ])
    await followVideoDownload("dl-1", { onProgress, fetchImpl, ...FAST })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it("ignores a completed frame with no file rather than resolving to nothing", async () => {
    const fetchImpl = fetchSequence([
      sse([frame({ phase: "completed", percent: 100 })]),
      sse([frame({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4" })]),
    ])
    expect(await followVideoDownload("dl-1", { onProgress: vi.fn(), fetchImpl, ...FAST })).toEqual({
      status: "completed",
      videoUrl: "https://cdn/v.mp4",
    })
  })

  it("reconnects when the stream breaks mid-download — the server keeps the download for minutes", async () => {
    const onProgress = vi.fn()
    const fetchImpl = fetchSequence([
      sse([frame({ phase: "downloading", percent: 40 })]), // ends with no terminal frame
      new TypeError("network"),
      sse([frame({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4" })]),
    ])
    const outcome = await followVideoDownload("dl-1", { onProgress, fetchImpl, ...FAST })
    expect(outcome).toEqual({ status: "completed", videoUrl: "https://cdn/v.mp4" })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("gives up as LOST after the reconnect budget — never a false 'failed'", async () => {
    const fetchImpl = fetchSequence([new TypeError("network")])
    const outcome = await followVideoDownload("dl-1", { onProgress: vi.fn(), fetchImpl, maxReconnects: 3, ...FAST })
    expect(outcome).toEqual({ status: "lost" })
    expect(fetchImpl).toHaveBeenCalledTimes(4) // the first try + 3 reconnects
  })

  it("a frame resets the reconnect budget — a long download survives many short drops", async () => {
    const answers: Array<Response | Error> = []
    for (let i = 0; i < 6; i++) answers.push(sse([frame({ phase: "downloading", percent: i })]))
    answers.push(sse([frame({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4" })]))
    const outcome = await followVideoDownload("dl-1", {
      onProgress: vi.fn(),
      fetchImpl: fetchSequence(answers),
      maxReconnects: 2,
      ...FAST,
    })
    expect(outcome.status).toBe("completed")
  })

  it("reports EXPIRED when the server no longer knows the download — immediately, no reconnects", async () => {
    const fetchImpl = fetchSequence([sse([], 404)])
    expect(await followVideoDownload("dl-1", { onProgress: vi.fn(), fetchImpl, ...FAST })).toEqual({ status: "expired" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("reports EXPIRED when the download vanishes mid-stream", async () => {
    const fetchImpl = fetchSequence([sse([frame({ phase: "failed", percent: 0, error: "Download expired" })])])
    expect(await followVideoDownload("dl-1", { onProgress: vi.fn(), fetchImpl, ...FAST })).toEqual({ status: "expired" })
  })

  it("stops quietly when aborted", async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => {
      controller.abort()
      throw new DOMException("aborted", "AbortError")
    })
    const outcome = await followVideoDownload("dl-1", { onProgress: vi.fn(), fetchImpl, signal: controller.signal, ...FAST })
    expect(outcome).toEqual({ status: "aborted" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("reads CRLF framing — a gateway may rewrite the line endings", async () => {
    const onProgress = vi.fn()
    const crlf = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\r\n\r\n`
    const fetchImpl = fetchSequence([
      sse([crlf({ phase: "downloading", percent: 30 }), crlf({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4" })]),
    ])
    expect(await followVideoDownload("dl-1", { onProgress, fetchImpl, ...FAST })).toEqual({
      status: "completed",
      videoUrl: "https://cdn/v.mp4",
    })
    expect(onProgress).toHaveBeenCalledWith({ phase: "downloading", percent: 30 })
  })

  it("stops waiting on a download that never MOVES — the server keeps sending frames, so silence is not the signal", async () => {
    let clock = 0
    const same = frame({ phase: "downloading", percent: 40 })
    // Every frame read advances the clock by a minute; the position never changes.
    const fetchImpl = fetchSequence([sse([same, same, same, same, same, same])])
    const outcome = await followVideoDownload("dl-1", {
      onProgress: vi.fn(),
      fetchImpl,
      stallMs: 3 * 60_000,
      now: () => (clock += 60_000),
      ...FAST,
    })
    expect(outcome).toEqual({ status: "lost" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("does not call a slow download stalled — any movement resets the clock", async () => {
    let clock = 0
    const frames = [10, 10, 11, 11, 12, 12].map((percent) => frame({ phase: "downloading", percent }))
    const fetchImpl = fetchSequence([
      sse([...frames, frame({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4" })]),
    ])
    const outcome = await followVideoDownload("dl-1", {
      onProgress: vi.fn(),
      fetchImpl,
      stallMs: 3 * 60_000,
      now: () => (clock += 60_000),
      ...FAST,
    })
    expect(outcome.status).toBe("completed")
  })

  it("skips a malformed frame and keeps reading", async () => {
    const fetchImpl = fetchSequence([
      sse(["data: {not json\n\n", ": keepalive\n\n", frame({ phase: "completed", percent: 100, videoUrl: "https://cdn/v.mp4" })]),
    ])
    expect((await followVideoDownload("dl-1", { onProgress: vi.fn(), fetchImpl, ...FAST })).status).toBe("completed")
  })
})
