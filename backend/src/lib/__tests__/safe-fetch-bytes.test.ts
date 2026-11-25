import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetch = vi.hoisted(() => vi.fn())
vi.mock("../safe-fetch.js", () => ({ safeFetch: fetch }))
import { boundedPublicChunks, safeFetchBytes, PublicDownloadTooLargeError } from "../safe-fetch-bytes.js"

beforeEach(() => vi.resetAllMocks())

function response(chunks: number[], headers: Record<string, string> = {}, status = 200) {
  const cancel = vi.fn()
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks.length) controller.close()
      else controller.enqueue(new Uint8Array(chunks[index++]!).fill(index))
    }, cancel,
  })
  fetch.mockResolvedValue(new Response(body, { status, headers }))
  return cancel
}

describe("bounded public image retrieval", () => {
  it("uses the safe transport and accepts exactly the requested decoded byte limit", async () => {
    response([2, 3])
    expect(await safeFetchBytes("https://media.test/image", 5)).toEqual(Buffer.from([1, 1, 2, 2, 2]))
    // Our own 30 s limit rides on the signal; safeFetch's timer is only a backstop past it.
    expect(fetch).toHaveBeenCalledWith("https://media.test/image", { timeoutMs: 35_000, signal: expect.any(AbortSignal) })
  })
  it.each<Record<string, string>>([{}, { "content-length": "1" }])("stops an oversized body despite unhelpful headers %j", async (headers) => {
    const cancel = response([3, 3, 3, 3], headers)
    const attempt = safeFetchBytes("https://media.test/image", 5)
    // The streamed count: a typed error, so a caller can say "too large".
    await expect(attempt).rejects.toBeInstanceOf(PublicDownloadTooLargeError)
    await expect(attempt).rejects.toThrow("size limit")
    expect(cancel).toHaveBeenCalledOnce()
  })
  it("cancels before buffering an advertised oversized response or an HTTP error", async () => {
    const tooLarge = response([10, 10], { "content-length": "100" })
    const attempt = safeFetchBytes("https://media.test/image", 5)
    // The advertised content-length: the same typed error.
    await expect(attempt).rejects.toBeInstanceOf(PublicDownloadTooLargeError)
    await expect(attempt).rejects.toThrow("size limit")
    expect(tooLarge).toHaveBeenCalledOnce()
    const failed = response([10, 10], {}, 403)
    const refused = safeFetchBytes("https://media.test/image", 5)
    await expect(refused).rejects.toThrow("download failed")
    // A refusal is not a size problem.
    await expect(refused).rejects.not.toBeInstanceOf(PublicDownloadTooLargeError)
    expect(failed).toHaveBeenCalledOnce()
  })
  it("refuses invalid limits before accessing the network", async () => {
    for (const limit of [0, -1, 0.5, NaN, Infinity, 25 * 1024 * 1024 + 1]) {
      await expect(safeFetchBytes("https://media.test/image", limit)).rejects.toThrow("Invalid")
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it("propagates transport and stream failures without returning partial bytes", async () => {
    fetch.mockRejectedValueOnce(new Error("blocked address"))
    await expect(safeFetchBytes("https://media.test/image", 5)).rejects.toThrow("blocked address")
    fetch.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.error(new Error("deadline")) } })))
    await expect(safeFetchBytes("https://media.test/image", 5)).rejects.toThrow("deadline")
  })
})

/**
 * `timeoutMs` ends the BODY, not only the request: a body that holds its
 * connection open and never ends is stopped at the limit even when the fetch
 * ignores its signal (this stub does).
 */
describe("the limit ends a body that never finishes", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }) })
  afterEach(() => { vi.useRealTimers() })

  function endless() {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8).fill(1)) }, cancel })
    fetch.mockImplementation(async () => new Response(body, { status: 200 }))
    return cancel
  }

  it("stops at the limit with a timeout naming it, and cancels the body", async () => {
    const cancel = endless()
    const settled = safeFetchBytes("https://media.test/endless", 1024).then(() => undefined, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(cancel).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    // Worded like the module's other errors, without the link.
    expect(await settled).toMatchObject({ name: "TimeoutError", message: "Image download timed out: over its 30 s limit" })
    expect(cancel).toHaveBeenCalled()
  })

  it("a disk consumer of the chunks is stopped too, and the caller's abort keeps its own reason", async () => {
    const cancel = endless()
    const caller = new AbortController()
    const chunks: Buffer[] = []
    const reading = (async () => {
      for await (const c of boundedPublicChunks("https://media.test/endless", { maxBytes: 1024, timeoutMs: 120_000, label: "Video", signal: caller.signal })) chunks.push(c)
    })().then(() => undefined, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1_000)
    caller.abort(new Error("job stopped"))
    expect(await reading).toMatchObject({ message: "job stopped" })
    expect(chunks).toHaveLength(1)
    expect(cancel).toHaveBeenCalled()
  })
})

/**
 * The opt-in size-scaled rule (`rate`) for a caller fetching up to 500 MB from
 * a host that may be slow: the response within `timeoutMs`, then a body that
 * keeps moving runs past it — held to a minimum per window, its announced size
 * at a floor rate, and an overall ceiling. Small numbers stand in for the
 * production ones (`DEFAULT_DOWNLOAD_LIMITS`: 120 s grace, 1 MB a minute,
 * 512 kB/s, 30 min).
 */
describe("size-scaled public downloads (rate)", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /** Grace 1 s, then ≥ 10 bytes per 1 s window; a known size at 10 B/s; at most 60 s. */
  const rate = { responseMs: 1_000, windowMs: 1_000, minBytesPerWindow: 10, floorBytesPerSec: 10, maxMs: 60_000 }

  /** A body of `count` chunks of `size` bytes, one every `everyMs`. */
  function trickle(count: number, size: number, everyMs: number, headers: Record<string, string> = {}) {
    const cancel = vi.fn()
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === count) { controller.close(); return }
        await new Promise((r) => setTimeout(r, everyMs))
        sent++
        controller.enqueue(new Uint8Array(size).fill(sent))
      },
      cancel,
    })
    // Ignores init.signal on purpose: the limits must not depend on the fetch honouring it.
    fetch.mockImplementation(async () => new Response(body, { status: 200, headers }))
    return cancel
  }

  async function read(opts: { timeoutMs?: number; maxBytes?: number } = {}) {
    let bytes = 0
    for await (const c of boundedPublicChunks("https://media.test/video", {
      maxBytes: opts.maxBytes ?? 10_000, timeoutMs: opts.timeoutMs ?? 2_000, label: "Video", rate,
    })) bytes += c.length
    return bytes
  }

  it("a slow-but-steady body completes long past the flat limit", async () => {
    // 30 × 20 bytes, one every 500 ms: 15 s, far past the 2 s that would bound the whole transfer flat.
    trickle(30, 20, 500, { "content-length": "600" })
    const settled = read().then((v) => v, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(16_000)
    expect(await settled).toBe(600)
  })

  it("a stalled body ends at the first window after the grace, naming the rate", async () => {
    const cancel = vi.fn()
    // One chunk, then silence: the stub's pull waits on a promise that never resolves after the first.
    let first = true
    fetch.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!first) return new Promise(() => undefined)
        first = false
        controller.enqueue(new Uint8Array(20))
        return undefined
      },
      cancel,
    }), { status: 200 }))
    const settled = read().then((v) => v, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await settled).toMatchObject({ name: "TimeoutError", message: expect.stringMatching(/^Video download timed out: too slow — 0 bytes in the last 1 s/) })
    expect(cancel).toHaveBeenCalled()
  })

  it("a known-size body that runs slower than its size at the floor rate ends at that deadline", async () => {
    // 100 bytes announced → 10 s at 10 B/s; delivered at 30 B/s (every window well above its minimum) but 375 bytes long.
    trickle(25, 15, 500, { "content-length": "100" })
    const settled = read().then((v) => v, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(await settled).toMatchObject({ name: "TimeoutError", message: expect.stringMatching(/^Video download timed out: longer than 10 s for its size/) })
  })

  it("nothing runs past the overall ceiling, response and body together", async () => {
    // Unknown size, steady 80 B/s for ever (every window well above its minimum): only the ceiling stops it.
    trickle(1_000_000, 20, 250)
    const settled = read({ maxBytes: 500 * 1024 * 1024 }).then((v) => v, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(59_999)
    let done = false
    void settled.then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await settled).toMatchObject({ name: "TimeoutError", message: "Video download timed out: over its 60 s overall limit" })
  })

  it("the response must still arrive within timeoutMs", async () => {
    fetch.mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
    }))
    const settled = read().then((v) => v, (e: unknown) => e)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await settled).toMatchObject({ name: "TimeoutError", message: "Video download timed out: no response within 2 s" })
  })

  it("safeFetch's own timer is a backstop past the ceiling, never the flat limit (else it would end a steady body)", async () => {
    trickle(1, 5, 0)
    const settled = read()
    await vi.advanceTimersByTimeAsync(10)
    await settled
    expect(fetch).toHaveBeenCalledWith("https://media.test/video", { timeoutMs: 65_000, signal: expect.any(AbortSignal) })
  })

  it("refuses a rate past the default path's ceiling or with a zero field, before any fetch", async () => {
    const bad = [{ ...rate, maxMs: 30 * 60_000 + 1 }, { ...rate, windowMs: 0 }, { ...rate, minBytesPerWindow: 0.5 }]
    for (const r of bad) {
      const attempt = (async () => { for await (const _ of boundedPublicChunks("https://media.test/video", { maxBytes: 10, timeoutMs: 1_000, label: "Video", rate: r })) { /* drain */ } })()
      await expect(attempt).rejects.toThrow("Invalid public download limits")
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe("image-sized callers keep the flat limit", () => {
  it("safeFetchBytes still bounds response and body by one 30 s total (no size scaling)", async () => {
    response([2])
    await safeFetchBytes("https://media.test/image", 5)
    expect(fetch).toHaveBeenCalledWith("https://media.test/image", { timeoutMs: 35_000, signal: expect.any(AbortSignal) })
  })
})
