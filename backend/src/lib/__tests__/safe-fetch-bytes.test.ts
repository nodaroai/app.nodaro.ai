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
