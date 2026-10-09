import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import sharp from "sharp"

vi.mock("../fetch-own-media.js", () => ({
  fetchOwnMedia: vi.fn(),
  // Our own media host, for these tests.
  isOwnMediaUrl: (url: string) => url.startsWith("https://cdn.example.com/"),
}))

import { fetchOwnMedia } from "../fetch-own-media.js"
import {
  probeImageDisplaySize,
  sourceImageForAutoAspect,
  forgetProbedImageSizes,
  SOURCE_SIZE_DEADLINE_MS,
  SOURCE_SIZE_MAX_READ_BYTES,
} from "../image-source-size.js"

/**
 * The size of the image an image-to-image / edit request transforms, read from
 * the first bytes of the file. Every failure answers `undefined`, which leaves
 * "auto" on its usual fallback — a probe must never be why a run fails.
 */

const fetchMock = vi.mocked(fetchOwnMedia)

const canvas = (width: number, height: number) => ({
  create: { width, height, channels: 3 as const, background: { r: 90, g: 40, b: 160 } },
})

async function jpeg(width: number, height: number, opts: { orientation?: number } = {}): Promise<Buffer> {
  let img = sharp(canvas(width, height)).jpeg({ quality: 85 })
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation })
  return img.toBuffer()
}

/**
 * `count` application segments of ~64 KB inserted after the start marker, the
 * way a camera's thumbnail / profile / XMP blocks sit ahead of the frame
 * header. Decoders skip them; they only push the size further into the file.
 */
function withLeadingSegments(file: Buffer, count: number): Buffer {
  const payload = 65_000
  const segments: Buffer[] = []
  for (let i = 0; i < count; i++) {
    segments.push(Buffer.from([0xff, 0xe3, ((payload + 2) >> 8) & 0xff, (payload + 2) & 0xff]), Buffer.alloc(payload, 0x41))
  }
  return Buffer.concat([file.subarray(0, 2), ...segments, file.subarray(2)])
}

/** A response whose body arrives in `chunkSize` pieces and counts what was pulled. */
function streamed(bytes: Buffer, status = 206, chunkSize = 16 * 1024) {
  let offset = 0
  const pulled = { bytes: 0 }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const chunk = bytes.subarray(offset, offset + chunkSize)
      offset += chunk.length
      pulled.bytes += chunk.length
      controller.enqueue(new Uint8Array(chunk))
    },
  })
  return { response: new Response(body, { status }), pulled }
}

beforeEach(() => {
  fetchMock.mockReset()
  forgetProbedImageSizes()
})

describe("probeImageDisplaySize", () => {
  it("reads a PNG's size", async () => {
    const png = await sharp(canvas(1104, 1472)).png().toBuffer()
    fetchMock.mockResolvedValue(streamed(png).response)
    expect(await probeImageDisplaySize("https://cdn.example.com/a.png")).toEqual({ width: 1104, height: 1472 })
  })

  it("reports a rotated phone photo as it is displayed", async () => {
    // Stored 1104x1472 with EXIF orientation 6 (a quarter turn) — shown landscape.
    fetchMock.mockResolvedValue(streamed(await jpeg(1104, 1472, { orientation: 6 })).response)
    expect(await probeImageDisplaySize("https://cdn.example.com/b.jpg")).toEqual({ width: 1472, height: 1104 })
  })

  it("keeps reading when the frame header sits past the first read", async () => {
    // ~195 KB of application segments ahead of the JPEG frame header.
    const big = withLeadingSegments(await jpeg(1920, 1080), 3)
    await expect(sharp(big.subarray(0, 64 * 1024)).metadata()).rejects.toThrow()
    fetchMock.mockResolvedValue(streamed(big).response)
    expect(await probeImageDisplaySize("https://cdn.example.com/c.jpg")).toEqual({ width: 1920, height: 1080 })
  })

  it("gives up on a header past the cap", async () => {
    const tooDeep = withLeadingSegments(await jpeg(1920, 1080), 9)
    fetchMock.mockResolvedValue(streamed(tooDeep).response)
    expect(await probeImageDisplaySize("https://cdn.example.com/deep.jpg")).toBeUndefined()
  })

  it("asks for a bounded byte range with a deadline", async () => {
    const png = await sharp(canvas(800, 600)).png().toBuffer()
    fetchMock.mockResolvedValue(streamed(png).response)
    await probeImageDisplaySize("https://cdn.example.com/d.png")
    const init = fetchMock.mock.calls[0]![1] as { headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal }
    expect(init.headers?.Range).toBe(`bytes=0-${SOURCE_SIZE_MAX_READ_BYTES - 1}`)
    expect(init.timeoutMs).toBeGreaterThan(0)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("stops reading a server that ignores the range once the size is known", async () => {
    // A 200 with a multi-megabyte body: the header is in the first chunk.
    const png = await sharp(canvas(640, 480)).png().toBuffer()
    const padded = Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)])
    const { response, pulled } = streamed(padded, 200)
    fetchMock.mockResolvedValue(response)
    expect(await probeImageDisplaySize("https://cdn.example.com/e.png")).toEqual({ width: 640, height: 480 })
    expect(pulled.bytes).toBeLessThanOrEqual(SOURCE_SIZE_MAX_READ_BYTES + 64 * 1024)
  })

  it("never reads past the cap when no header is found", async () => {
    const { response, pulled } = streamed(Buffer.alloc(4 * 1024 * 1024, 7), 200)
    fetchMock.mockResolvedValue(response)
    expect(await probeImageDisplaySize("https://cdn.example.com/f.bin")).toBeUndefined()
    expect(pulled.bytes).toBeLessThanOrEqual(SOURCE_SIZE_MAX_READ_BYTES + 64 * 1024)
  })

  it("answers undefined for a missing file", async () => {
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }))
    expect(await probeImageDisplaySize("https://cdn.example.com/missing.png")).toBeUndefined()
  })

  it("answers undefined when the fetch fails or times out", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    expect(await probeImageDisplaySize("https://cdn.example.com/slow.png")).toBeUndefined()
  })

  it("answers undefined for a file that is not an image", async () => {
    fetchMock.mockResolvedValue(streamed(Buffer.from("<html><body>hello</body></html>")).response)
    expect(await probeImageDisplaySize("https://cdn.example.com/page.html")).toBeUndefined()
  })

  it("reads one of our own urls once, and retries one it could not read", async () => {
    const png = await sharp(canvas(300, 200)).png().toBuffer()
    fetchMock.mockImplementation(async () => streamed(png).response)
    await probeImageDisplaySize("https://cdn.example.com/g.png")
    await probeImageDisplaySize("https://cdn.example.com/g.png")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 }))
    fetchMock.mockImplementation(async () => streamed(png).response)
    expect(await probeImageDisplaySize("https://cdn.example.com/h.png")).toBeUndefined()
    expect(await probeImageDisplaySize("https://cdn.example.com/h.png")).toEqual({ width: 300, height: 200 })
  })

  it("never remembers a size read from someone else's host — those bytes can change", async () => {
    const png = await sharp(canvas(300, 200)).png().toBuffer()
    fetchMock.mockImplementation(async () => streamed(png).response)
    await probeImageDisplaySize("https://elsewhere.example.org/i.png")
    await probeImageDisplaySize("https://elsewhere.example.org/i.png")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("probeImageDisplaySize — its deadline holds", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("answers undefined at the deadline when the request never answers, and aborts it", async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_url, init) => {
      signal = (init as { signal?: AbortSignal } | undefined)?.signal
      return new Promise<Response>(() => {})
    })
    let result: unknown = "pending"
    void probeImageDisplaySize("https://cdn.example.com/slow.png").then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(SOURCE_SIZE_DEADLINE_MS - 1)
    expect(result).toBe("pending")
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBeUndefined()
    expect(signal?.aborted).toBe(true)
  })

  it("answers undefined at the deadline when the body stalls", async () => {
    const stalled = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) })
    fetchMock.mockResolvedValue(new Response(stalled, { status: 206 }))
    let result: unknown = "pending"
    void probeImageDisplaySize("https://cdn.example.com/stall.png").then((r) => { result = r })
    await vi.advanceTimersByTimeAsync(SOURCE_SIZE_DEADLINE_MS)
    expect(result).toBeUndefined()
  })

  it("leaves no timer behind once it has an answer", async () => {
    vi.useRealTimers()
    const png = await sharp(canvas(320, 240)).png().toBuffer()
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(streamed(png).response)
    await expect(probeImageDisplaySize("https://cdn.example.com/quick.png")).resolves.toEqual({ width: 320, height: 240 })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("sourceImageForAutoAspect", () => {
  it("reads the source only for 'auto' on a model without a native auto", async () => {
    const png = await sharp(canvas(1600, 1200)).png().toBuffer()
    fetchMock.mockImplementation(async () => streamed(png).response)
    expect(await sourceImageForAutoAspect("seedream-5-pro-i2i", "auto", "https://cdn.example.com/s.png")).toEqual({ width: 1600, height: 1200 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not touch the network when the size would not be used", async () => {
    expect(await sourceImageForAutoAspect("gpt-image-2-i2i", "auto", "https://cdn.example.com/s.png")).toBeUndefined()
    expect(await sourceImageForAutoAspect("seedream-5-pro-i2i", "16:9", "https://cdn.example.com/s.png")).toBeUndefined()
    expect(await sourceImageForAutoAspect("seedream-5-pro-i2i", "auto", undefined)).toBeUndefined()
    expect(await sourceImageForAutoAspect("seedream-5-pro-i2i", "auto", "")).toBeUndefined()
    expect(await sourceImageForAutoAspect("seedream-5-pro-i2i", "auto", { url: "x" })).toBeUndefined()
    expect(await sourceImageForAutoAspect(undefined, "auto", "https://cdn.example.com/s.png")).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
