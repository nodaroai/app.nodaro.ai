import { beforeEach, describe, expect, it, vi } from "vitest"

const fetch = vi.hoisted(() => vi.fn())
vi.mock("../safe-fetch.js", () => ({ safeFetch: fetch }))
import { safeFetchBytes } from "../safe-fetch-bytes.js"

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
    expect(fetch).toHaveBeenCalledWith("https://media.test/image", { timeoutMs: 30_000 })
  })
  it.each<Record<string, string>>([{}, { "content-length": "1" }])("stops an oversized body despite unhelpful headers %j", async (headers) => {
    const cancel = response([3, 3, 3, 3], headers)
    await expect(safeFetchBytes("https://media.test/image", 5)).rejects.toThrow("size limit")
    expect(cancel).toHaveBeenCalledOnce()
  })
  it("cancels before buffering an advertised oversized response or an HTTP error", async () => {
    const tooLarge = response([10, 10], { "content-length": "100" })
    await expect(safeFetchBytes("https://media.test/image", 5)).rejects.toThrow("size limit")
    expect(tooLarge).toHaveBeenCalledOnce()
    const failed = response([10, 10], {}, 403)
    await expect(safeFetchBytes("https://media.test/image", 5)).rejects.toThrow("download failed")
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
