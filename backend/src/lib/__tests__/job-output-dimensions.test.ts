import { Readable } from "node:stream"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import sharp from "sharp"

/**
 * THE stamp of an image job's pixel size on its output_data. Sizes come from
 * what this process noted when it stored the file, else from a bounded read of
 * the stored file's first bytes through the storage client — never the public
 * URL, never a foreign host. Any failure leaves the fields out; nothing throws.
 */

const storage = vi.hoisted(() => ({
  streamR2Object: vi.fn(),
  // Our bucket is everything under https://cdn.test/ (the real rule is
  // origin + path prefix — lib/storage.ts r2KeyFromOurUrl).
  r2KeyFromOurUrl: vi.fn((url: string) => (url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length).split("?")[0] : null)),
}))
vi.mock("../storage.js", () => storage)

import {
  withImageDimensions,
  withOutputImageDimensions,
  OUTPUT_DIMENSIONS_DEADLINE_MS,
} from "../job-output-dimensions.js"
import { noteStoredImage, forgetStoredImageDimensions, IMAGE_HEADER_MAX_READ_BYTES } from "../image-dimensions.js"

const canvas = (width: number, height: number) => ({
  create: { width, height, channels: 3 as const, background: { r: 200, g: 60, b: 20 } },
})
const png = (w: number, h: number) => sharp(canvas(w, h)).png().toBuffer()

/** A stored object as streamR2Object answers it, its body in `chunkSize` pieces. */
function stored(bytes: Buffer, contentType: string | null = "image/png", chunkSize = 16 * 1024) {
  const pieces: Buffer[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) pieces.push(bytes.subarray(i, i + chunkSize))
  const body = Readable.from(pieces)
  return { object: { body, contentType, contentLength: bytes.length, contentRange: null }, body }
}

/** `count` ~64 KB application segments after the JPEG start marker — the size sits past them. */
function withLeadingSegments(file: Buffer, count: number): Buffer {
  const payload = 65_000
  const segments: Buffer[] = []
  for (let i = 0; i < count; i++) {
    segments.push(Buffer.from([0xff, 0xe3, ((payload + 2) >> 8) & 0xff, (payload + 2) & 0xff]), Buffer.alloc(payload, 0x41))
  }
  return Buffer.concat([file.subarray(0, 2), ...segments, file.subarray(2)])
}

beforeEach(() => {
  storage.streamR2Object.mockReset()
  storage.r2KeyFromOurUrl.mockClear()
  forgetStoredImageDimensions()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("withImageDimensions — what is stamped", () => {
  it("an output with no image is returned as is, without any read", async () => {
    for (const out of [{ videoUrl: "https://cdn.test/videos/a.mp4" }, { audioUrl: "https://cdn.test/audios/a.wav" }, { json: { a: 1 } }, {}]) {
      expect(await withImageDimensions(out)).toBe(out)
    }
    expect(await withImageDimensions(null)).toBeNull()
    expect(await withImageDimensions({ imageUrl: "" })).toEqual({ imageUrl: "" })
    expect(storage.streamR2Object).not.toHaveBeenCalled()
  })

  it("stamps width and height of imageUrl from the size noted when this process stored it — no read", async () => {
    await noteStoredImage("https://cdn.test/images/job-1.png", await png(1024, 1536))
    const out = { imageUrl: "https://cdn.test/images/job-1.png", seed: 7 }
    expect(await withImageDimensions(out)).toEqual({ imageUrl: "https://cdn.test/images/job-1.png", seed: 7, width: 1024, height: 1536 })
    expect(out).toEqual({ imageUrl: "https://cdn.test/images/job-1.png", seed: 7 }) // input untouched
    expect(storage.streamR2Object).not.toHaveBeenCalled()
  })

  it("otherwise reads the stored file's first bytes through the storage client, in one bounded range", async () => {
    const { object } = stored(await png(800, 600))
    storage.streamR2Object.mockResolvedValueOnce(object)
    expect(await withImageDimensions({ imageUrl: "https://cdn.test/images/job-2.png" })).toMatchObject({ width: 800, height: 600 })
    const [key, opts] = storage.streamR2Object.mock.calls[0] as [string, { range: string; signal: AbortSignal }]
    expect(key).toBe("images/job-2.png")
    expect(opts.range).toBe(`bytes=0-${IMAGE_HEADER_MAX_READ_BYTES - 1}`)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it("keeps reading when the size sits past the first 64 KB, and stops once it has it", async () => {
    const jpeg = withLeadingSegments(await sharp(canvas(1920, 1080)).jpeg().toBuffer(), 3)
    const { object, body } = stored(Buffer.concat([jpeg, Buffer.alloc(2 * 1024 * 1024)]), "image/jpeg")
    storage.streamR2Object.mockResolvedValueOnce(object)
    expect(await withImageDimensions({ imageUrl: "https://cdn.test/images/job-3.png" })).toMatchObject({ width: 1920, height: 1080 })
    expect(body.destroyed).toBe(true)
  })

  it("never fetches a foreign url, and never reads a video or audio file (an output that aliases imageUrl to its MP4)", async () => {
    const foreign = { imageUrl: "https://provider.example/out.png" }
    expect(await withImageDimensions(foreign)).toBe(foreign)
    // The motion reference sheet stores its MP4 at reference-sheets/<jobId>.mp4
    // and publishes it under imageUrl too (services/reference-sheet/motion-compositor.ts).
    const motionSheet = { videoUrl: "https://cdn.test/reference-sheets/job-9.mp4", imageUrl: "https://cdn.test/reference-sheets/job-9.mp4" }
    expect(await withImageDimensions(motionSheet)).toBe(motionSheet)
    for (const url of ["https://cdn.test/videos/a.mp4", "https://cdn.test/x/clip.MOV", "https://cdn.test/audios/a.wav", "https://cdn.test/y/voice.mp3?sig=1"]) {
      const out = { imageUrl: url }
      expect(await withImageDimensions(out)).toBe(out)
    }
    expect(storage.streamR2Object).not.toHaveBeenCalled()
  })

  it("a file this process stored and could not read a size from is not read back (the same bytes)", async () => {
    await noteStoredImage("https://cdn.test/images/odd-1.png", Buffer.from("not an image"))
    const out = { imageUrl: "https://cdn.test/images/odd-1.png" }
    expect(await withImageDimensions(out)).toBe(out)
    expect(storage.streamR2Object).not.toHaveBeenCalled()
  })

  it("reads at most 4 stored files at a time", async () => {
    const bytes = await png(20, 10)
    let inFlight = 0
    let most = 0
    storage.streamR2Object.mockImplementation(async () => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 15))
      inFlight--
      return stored(bytes).object
    })
    const urls = Array.from({ length: 7 }, (_, i) => `https://cdn.test/images/job-10${i ? `-v${i}` : ""}.png`)
    const out = await withImageDimensions({ imageUrl: urls[0], imageUrls: urls })
    expect(most).toBeLessThanOrEqual(4)
    expect(storage.streamR2Object).toHaveBeenCalledTimes(7)
    expect((out as unknown as { images: Array<{ width?: number }> }).images.every((image) => image.width === 20)).toBe(true)
  })

  it("a stored object that is not an image is left unmeasured", async () => {
    const { object, body } = stored(Buffer.alloc(1024), "video/mp4")
    storage.streamR2Object.mockResolvedValueOnce(object)
    const out = { imageUrl: "https://cdn.test/images/odd.png" }
    expect(await withImageDimensions(out)).toBe(out)
    expect(body.destroyed).toBe(true)
  })

  it("a lane that records its own size keeps it (image-overlay) — nothing is read for it", async () => {
    const out = { imageUrl: "https://cdn.test/images/overlay.png", width: 1080, height: 1920, maskUrl: "https://cdn.test/images/mask.png" }
    expect(await withImageDimensions(out)).toBe(out)
    expect(storage.streamR2Object).not.toHaveBeenCalled()
  })

  it("several images: images[] beside imageUrls, index-aligned; top-level width/height describe imageUrl", async () => {
    const urls = ["https://cdn.test/images/job-4.png", "https://cdn.test/images/job-4-v1.png", "https://cdn.test/images/job-4-v2.png"]
    await noteStoredImage(urls[0]!, await png(1024, 1024))
    await noteStoredImage(urls[2]!, await png(1024, 1536))
    storage.streamR2Object.mockResolvedValueOnce(stored(await png(1536, 1024)).object)
    const out = { imageUrl: urls[0], imageUrls: urls }
    expect(await withImageDimensions(out)).toEqual({
      imageUrl: urls[0],
      imageUrls: urls, // unchanged: still strings
      width: 1024,
      height: 1024,
      images: [
        { url: urls[0], width: 1024, height: 1024 },
        { url: urls[1], width: 1536, height: 1024 },
        { url: urls[2], width: 1024, height: 1536 },
      ],
    })
    expect(storage.streamR2Object).toHaveBeenCalledTimes(1)
  })

  it("an entry that cannot be measured keeps its url and no size; nothing measured adds nothing", async () => {
    const urls = ["https://cdn.test/images/job-5.png", "https://cdn.test/images/job-5-v1.png"]
    await noteStoredImage(urls[0]!, await png(640, 640))
    storage.streamR2Object.mockResolvedValueOnce(null)
    expect(await withImageDimensions({ imageUrl: urls[0], imageUrls: urls })).toMatchObject({
      width: 640,
      height: 640,
      images: [{ url: urls[0], width: 640, height: 640 }, { url: urls[1] }],
    })

    forgetStoredImageDimensions()
    storage.streamR2Object.mockResolvedValue(null)
    const none = { imageUrl: urls[0], imageUrls: urls }
    expect(await withImageDimensions(none)).toBe(none)
  })

  it("an images field a lane already wrote is left as it is", async () => {
    await noteStoredImage("https://cdn.test/images/job-6.png", await png(10, 20))
    const out = { imageUrl: "https://cdn.test/images/job-6.png", imageUrls: ["https://cdn.test/images/job-6.png"], images: "theirs" }
    expect(await withImageDimensions(out)).toEqual({ ...out, width: 10, height: 20 })
  })
})

describe("withImageDimensions — never slower than its deadline, never a failure", () => {
  it("a read that fails or throws leaves the fields out", async () => {
    storage.streamR2Object.mockRejectedValueOnce(new Error("store down"))
    const a = { imageUrl: "https://cdn.test/images/a.png" }
    expect(await withImageDimensions(a)).toBe(a)

    const broken = new Readable({ read() { this.destroy(new Error("reset")) } })
    storage.streamR2Object.mockResolvedValueOnce({ body: broken, contentType: "image/png", contentLength: null, contentRange: null })
    const b = { imageUrl: "https://cdn.test/images/b.png" }
    expect(await withImageDimensions(b)).toBe(b)

    storage.streamR2Object.mockResolvedValueOnce(stored(Buffer.from("not an image")).object)
    const c = { imageUrl: "https://cdn.test/images/c.png" }
    expect(await withImageDimensions(c)).toBe(c)
  })

  it("a read that never answers is abandoned at the deadline, its request aborted", async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    storage.streamR2Object.mockImplementationOnce((_key: string, opts: { signal: AbortSignal }) => {
      seen = opts.signal
      return new Promise(() => {})
    })
    const out = { imageUrl: "https://cdn.test/images/slow.png" }
    const pending = withImageDimensions(out)
    await vi.advanceTimersByTimeAsync(OUTPUT_DIMENSIONS_DEADLINE_MS)
    expect(await pending).toBe(out)
    expect(seen?.aborted).toBe(true)
  })

  it("the sizes that arrived before the deadline are kept", async () => {
    const fast = stored(await png(300, 200)).object
    storage.streamR2Object.mockImplementation((key: string) => (key.endsWith("-v1.png") ? new Promise(() => {}) : Promise.resolve(fast)))
    const urls = ["https://cdn.test/images/job-7.png", "https://cdn.test/images/job-7-v1.png"]
    const started = Date.now()
    const out = await withImageDimensions({ imageUrl: urls[0], imageUrls: urls }, { deadlineMs: 300 })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(out).toMatchObject({ width: 300, height: 200, images: [{ url: urls[0], width: 300, height: 200 }, { url: urls[1] }] })
  })
})

describe("withOutputImageDimensions — the completion fields", () => {
  it("stamps output_data and leaves every other column as it was", async () => {
    await noteStoredImage("https://cdn.test/images/job-8.png", await png(512, 512))
    const fields = { output_data: { imageUrl: "https://cdn.test/images/job-8.png" }, provider: "gpt-image", provider_cost: 0.04 }
    expect(await withOutputImageDimensions(fields)).toEqual({
      output_data: { imageUrl: "https://cdn.test/images/job-8.png", width: 512, height: 512 },
      provider: "gpt-image",
      provider_cost: 0.04,
    })
    expect(fields.output_data).toEqual({ imageUrl: "https://cdn.test/images/job-8.png" })
  })

  it("returns the very same fields when there is nothing to add", async () => {
    const video = { output_data: { videoUrl: "https://cdn.test/videos/v.mp4", thumbnailUrl: "https://cdn.test/thumbnails/v.png" } }
    expect(await withOutputImageDimensions(video)).toBe(video)
    const noOutput = { provider: "x" }
    expect(await withOutputImageDimensions(noOutput)).toBe(noOutput)
  })
})
