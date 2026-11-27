/**
 * A photo over a network's byte limit is re-encoded as a JPEG that fits before
 * it is posted (Facebook refused a 2K GPT Image 2 PNG: "Photos should be less
 * than 10 MB"). Pinned here: what is sent as it is (without a copy), what is
 * re-encoded at its own size, what is scaled down, what is never read, what
 * fails open, and what a failure to store the copy, or no time left, means for
 * the post.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

const OWN_HOST = "https://cdn.test/"
const OWN_URL = `${OWN_HOST}images/a.png`
const OUTSIDE_URL = "https://example.com/a.png"
const COPY_URL = `${OWN_HOST}tmp/provider-input/job/social-photo-1.jpg`
const JOB = "11111111-2222-4333-8444-555555555555"

vi.mock("../../../lib/fetch-own-media.js", () => ({
  isOwnMediaUrl: (url: string) => url.startsWith("https://cdn.test/"),
}))

const net = vi.hoisted(() => ({ head: vi.fn(), chunks: vi.fn() }))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: net.head }))
vi.mock("../../../lib/safe-fetch-bytes.js", () => ({ boundedPublicChunks: net.chunks }))

const scratch = vi.hoisted(() => ({ upload: vi.fn(), discard: vi.fn() }))
vi.mock("../../../lib/job-scratch.js", () => ({
  uploadJobScratchBuffer: scratch.upload,
  discardJobScratchFile: scratch.discard,
}))

import { discardPhotoCopies, fitPhotoUnderBytes, fitRequestPhotos, PUBLISH_CALL_RESERVE_MS } from "../photo-fit.js"
import { META_PHOTO_MAX_BYTES } from "../photo-limits.js"
import { NotPublishedError } from "../providers/types.js"

/** Gaussian noise: barely compressible, so its PNG is large and its JPEG smaller, but not tiny. */
async function noisePng(width: number, height: number, channels: 3 | 4 = 3): Promise<Buffer> {
  // `background` is required by the type and unused once `noise` is given.
  const create = { width, height, channels, background: { r: 0, g: 0, b: 0, alpha: 1 }, noise: { type: "gaussian" as const, mean: 128, sigma: 40 } }
  return sharp({ create }).png().toBuffer()
}

/** The JPEG the fitter makes at the photo's own size, for a limit to be set against. */
async function jpegAtFullSize(png: Buffer): Promise<Buffer> {
  return sharp(png).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer()
}

/** A limit the photo's PNG is over and its JPEG at full size is within. */
async function limitBetween(png: Buffer): Promise<number> {
  const jpeg = await jpegAtFullSize(png)
  expect(png.length).toBeGreaterThan(jpeg.length)
  return Math.floor((png.length + jpeg.length) / 2)
}

function headAnswer(headers: Record<string, string>, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), body: null }
}

function streamOf(...pieces: Buffer[]) {
  return async function* () {
    for (const piece of pieces) yield piece
  }
}

/** Our own photo: its HEAD answer states its size, its download yields its bytes. */
function ownPhoto(bytes: Buffer): void {
  net.head.mockResolvedValue(headAnswer({ "content-length": String(bytes.length) }))
  net.chunks.mockImplementation(streamOf(bytes))
}

/** The JPEG that was stored, and what it was stored as. */
function storedCopy(): { bytes: Buffer; name: unknown; ext: unknown; type: unknown; jobId: unknown } {
  const [bytes, name, ext, type, jobId] = scratch.upload.mock.calls[0] as [Buffer, unknown, unknown, unknown, unknown]
  return { bytes, name, ext, type, jobId }
}

function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null).catch((e: unknown) => e)
}

beforeEach(() => {
  net.head.mockReset()
  net.chunks.mockReset()
  scratch.upload.mockReset().mockResolvedValue(COPY_URL)
  scratch.discard.mockReset().mockResolvedValue(undefined)
})

describe("Meta's photo limit", () => {
  it("is under both of Meta's limits: Facebook's 10 MB and Instagram's 8 MB", () => {
    expect(META_PHOTO_MAX_BYTES).toBeLessThan(10 * 1000 * 1000)
    expect(META_PHOTO_MAX_BYTES).toBeLessThanOrEqual(8 * 1000 * 1000)
  })
})

describe("fitPhotoUnderBytes", () => {
  it("sends a photo within the limit as it is, without downloading it", async () => {
    net.head.mockResolvedValue(headAnswer({ "content-length": "1000" }))

    const fitted = await fitPhotoUnderBytes(OWN_URL, 5_000, JOB)

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(net.head).toHaveBeenCalledWith(OWN_URL, expect.objectContaining({ method: "HEAD" }))
    expect(net.chunks).not.toHaveBeenCalled()
    expect(scratch.upload).not.toHaveBeenCalled()
  })

  it("re-encodes an oversized photo as a JPEG at its own size when that fits", async () => {
    const png = await noisePng(320, 240)
    const limit = await limitBetween(png)
    ownPhoto(png)

    const fitted = await fitPhotoUnderBytes(OWN_URL, limit, JOB)

    expect(fitted).toEqual({ url: COPY_URL, copied: true })
    const copy = storedCopy()
    expect([copy.name, copy.ext, copy.type, copy.jobId]).toEqual(["social-photo", "jpg", "image/jpeg", JOB])
    const meta = await sharp(copy.bytes).metadata()
    expect(meta.format).toBe("jpeg")
    expect([meta.width, meta.height]).toEqual([320, 240])
    expect(copy.bytes.length).toBeLessThanOrEqual(limit)
    // Read through its public address, the one the network fetches.
    expect(net.chunks).toHaveBeenCalledWith(OWN_URL, expect.objectContaining({ label: "Image" }))
  })

  it("scales a photo down only when its JPEG at full size is still too large, keeping its shape", async () => {
    const png = await noisePng(400, 300)
    const limit = Math.floor((await jpegAtFullSize(png)).length / 3)
    ownPhoto(png)

    const fitted = await fitPhotoUnderBytes(OWN_URL, limit, JOB)

    expect(fitted.copied).toBe(true)
    const copy = storedCopy()
    const meta = await sharp(copy.bytes).metadata()
    expect(copy.bytes.length).toBeLessThanOrEqual(limit)
    expect(meta.width!).toBeLessThan(400)
    expect(Math.abs(meta.width! / meta.height! - 400 / 300)).toBeLessThan(0.02)
  })

  it("lays a transparent photo on white (a JPEG has no transparency)", async () => {
    const png = await noisePng(200, 200, 4)
    ownPhoto(png)

    await fitPhotoUnderBytes(OWN_URL, await limitBetween(png), JOB)

    const meta = await sharp(storedCopy().bytes).metadata()
    expect(meta.channels).toBe(3)
    expect(meta.hasAlpha).toBe(false)
  })

  it("sends an outside link as it is, without reading anything", async () => {
    const fitted = await fitPhotoUnderBytes(OUTSIDE_URL, 100, JOB)

    expect(fitted).toEqual({ url: OUTSIDE_URL, copied: false })
    expect(net.head).not.toHaveBeenCalled()
    expect(net.chunks).not.toHaveBeenCalled()
  })

  it.each([403, 404])("never downloads a photo whose public address answers %s: the network meets the same answer", async (status) => {
    net.head.mockResolvedValue(headAnswer({}, status))

    const fitted = await fitPhotoUnderBytes(OWN_URL, 100, JOB)

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(net.chunks).not.toHaveBeenCalled()
  })

  it("downloads a photo of unstated size and sends it as it is when it fits", async () => {
    net.head.mockResolvedValue(headAnswer({}))
    net.chunks.mockImplementation(streamOf(Buffer.alloc(3_000)))

    const fitted = await fitPhotoUnderBytes(OWN_URL, 5_000, JOB)

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(scratch.upload).not.toHaveBeenCalled()
  })

  it("downloads the photo when its size cannot be asked, and re-encodes it when over", async () => {
    const png = await noisePng(320, 240)
    const limit = await limitBetween(png)
    net.head.mockRejectedValue(new TypeError("fetch failed"))
    const half = Math.floor(png.length / 2)
    net.chunks.mockImplementation(streamOf(png.subarray(0, half), png.subarray(half)))

    const fitted = await fitPhotoUnderBytes(OWN_URL, limit, JOB)

    expect(fitted).toEqual({ url: COPY_URL, copied: true })
  })

  it("sends a photo it cannot download as it is", async () => {
    net.head.mockResolvedValue(headAnswer({ "content-length": "50000000" }))
    net.chunks.mockImplementation(async function* () {
      yield Buffer.alloc(0)
      throw new Error("socket hang up")
    })

    const fitted = await fitPhotoUnderBytes(OWN_URL, 5_000, JOB)

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(scratch.upload).not.toHaveBeenCalled()
  })

  it("sends a file that is not a picture as it is", async () => {
    ownPhoto(Buffer.from("<html>not a picture</html>".repeat(100)))

    const fitted = await fitPhotoUnderBytes(OWN_URL, 100, JOB)

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(scratch.upload).not.toHaveBeenCalled()
  })

  it("sends an animated picture as it is: a JPEG would keep one frame", async () => {
    const frame = (r: number) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 0, b: 0 } } }).png().toBuffer()
    const gif = await sharp([await frame(255), await frame(0)], { join: { animated: true } }).gif().toBuffer()
    expect((await sharp(gif).metadata()).pages).toBe(2)
    ownPhoto(gif)

    const fitted = await fitPhotoUnderBytes(OWN_URL, 10, JOB)

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(scratch.upload).not.toHaveBeenCalled()
  })

  it("sends an SVG as it is: it is never drawn", async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!--${"x".repeat(2_000)}--><rect width="10" height="10"/></svg>`)
    ownPhoto(svg)

    const fitted = await fitPhotoUnderBytes(OWN_URL, 100, JOB)

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(scratch.upload).not.toHaveBeenCalled()
  })

  it("reports a copy it could not store as NOT published, safe to retry", async () => {
    const png = await noisePng(320, 240)
    const limit = await limitBetween(png)
    ownPhoto(png)
    scratch.upload.mockRejectedValue(new Error("storage unavailable"))

    const err = await failureOf(fitPhotoUnderBytes(OWN_URL, limit, JOB))

    expect(err).toBeInstanceOf(NotPublishedError)
    expect((err as Error).message).toMatch(/NOT published/)
    expect((err as Error).message).not.toMatch(/MAY have been published|storage unavailable/i)
  })

  it("sends the photo as it is when the deadline leaves no time to ask its size", async () => {
    const fitted = await fitPhotoUnderBytes(OWN_URL, 100, JOB, { deadlineMs: Date.now() + PUBLISH_CALL_RESERVE_MS - 1_000 })

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(net.head).not.toHaveBeenCalled()
  })

  it("reports a photo it has no time left to re-encode as NOT published, safe to retry", async () => {
    net.head.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return headAnswer({ "content-length": "50000000" })
    })

    const err = await failureOf(fitPhotoUnderBytes(OWN_URL, 5_000, JOB, { deadlineMs: Date.now() + PUBLISH_CALL_RESERVE_MS + 60 }))

    expect(err).toBeInstanceOf(NotPublishedError)
    expect(net.chunks).not.toHaveBeenCalled()
  })

  it("re-encodes one photo at a time", async () => {
    const png = await noisePng(320, 240)
    const limit = await limitBetween(png)
    net.head.mockResolvedValue(headAnswer({ "content-length": String(png.length) }))
    let releaseFirst: () => void = () => {}
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    net.chunks
      .mockImplementationOnce(async function* () {
        await firstHeld
        yield png
      })
      .mockImplementation(streamOf(png))

    const first = fitPhotoUnderBytes(`${OWN_HOST}images/1.png`, limit, JOB)
    const second = fitPhotoUnderBytes(`${OWN_HOST}images/2.png`, limit, JOB)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(net.chunks).toHaveBeenCalledTimes(1)

    releaseFirst()
    await Promise.all([first, second])
    expect(net.chunks).toHaveBeenCalledTimes(2)
    expect(scratch.upload).toHaveBeenCalledTimes(2)
  })
})

describe("fitRequestPhotos", () => {
  it("leaves the request as it is when the network declares no photo limit", async () => {
    const request = { action: "post-image", mediaUrl: OWN_URL }

    const fitted = await fitRequestPhotos(request, undefined, JOB)

    expect(fitted.request).toBe(request)
    expect(fitted.copies).toEqual([])
    expect(net.head).not.toHaveBeenCalled()
  })

  it("puts the fitted photo in a new request and leaves the given one untouched", async () => {
    const png = await noisePng(320, 240)
    const limit = await limitBetween(png)
    ownPhoto(png)
    const request = { action: "post-image", caption: "hi", mediaUrl: OWN_URL }

    const fitted = await fitRequestPhotos(request, limit, JOB)

    expect(fitted.request).toEqual({ action: "post-image", caption: "hi", mediaUrl: COPY_URL })
    expect(fitted.copies).toEqual([COPY_URL])
    expect(request.mediaUrl).toBe(OWN_URL)
  })

  it("never touches a video", async () => {
    const request = { action: "post-video", mediaUrl: OWN_URL, mediaItems: [{ type: "video" as const, url: OWN_URL }] }

    const fitted = await fitRequestPhotos(request, 5_000, JOB)

    expect(fitted.request).toEqual(request)
    expect(fitted.copies).toEqual([])
    expect(net.head).not.toHaveBeenCalled()
  })

  it("fits only what the action posts: a scheduled photo post's mediaUrl, not its item list", async () => {
    const png = await noisePng(320, 240)
    const limit = await limitBetween(png)
    ownPhoto(png)
    const request = { action: "post-image", mediaUrl: OWN_URL, mediaItems: [{ type: "photo" as const, url: OWN_URL }] }

    const fitted = await fitRequestPhotos(request, limit, JOB)

    expect(scratch.upload).toHaveBeenCalledTimes(1)
    expect(fitted.request).toEqual({ action: "post-image", mediaUrl: COPY_URL, mediaItems: [{ type: "photo", url: OWN_URL }] })
    expect(fitted.copies).toEqual([COPY_URL])
  })

  it("fits every photo of a carousel", async () => {
    const png = await noisePng(320, 240)
    const limit = await limitBetween(png)
    ownPhoto(png)
    scratch.upload.mockResolvedValueOnce(`${COPY_URL}?1`).mockResolvedValueOnce(`${COPY_URL}?2`)
    const request = {
      action: "post-carousel",
      mediaItems: [
        { type: "photo" as const, url: `${OWN_HOST}images/1.png` },
        { type: "photo" as const, url: `${OWN_HOST}images/2.png` },
      ],
    }

    const fitted = await fitRequestPhotos(request, limit, JOB)

    expect(fitted.request.mediaItems).toEqual([
      { type: "photo", url: `${COPY_URL}?1` },
      { type: "photo", url: `${COPY_URL}?2` },
    ])
    expect(fitted.copies).toEqual([`${COPY_URL}?1`, `${COPY_URL}?2`])
  })

  it("discards the copies already made when a later photo fails, and rethrows", async () => {
    const png = await noisePng(320, 240)
    const limit = await limitBetween(png)
    ownPhoto(png)
    scratch.upload.mockResolvedValueOnce(COPY_URL).mockRejectedValueOnce(new Error("storage unavailable"))
    const request = {
      action: "post-carousel",
      mediaItems: [
        { type: "photo" as const, url: `${OWN_HOST}images/1.png` },
        { type: "photo" as const, url: `${OWN_HOST}images/2.png` },
      ],
    }

    await expect(fitRequestPhotos(request, limit, JOB)).rejects.toBeInstanceOf(NotPublishedError)
    expect(scratch.discard).toHaveBeenCalledWith(COPY_URL, JOB)
  })
})

describe("discardPhotoCopies", () => {
  it("deletes each copy from the job's scratch folder", async () => {
    await discardPhotoCopies([COPY_URL, `${COPY_URL}?2`], JOB)

    expect(scratch.discard).toHaveBeenCalledWith(COPY_URL, JOB)
    expect(scratch.discard).toHaveBeenCalledWith(`${COPY_URL}?2`, JOB)
  })

  it("does nothing when no copy was made", async () => {
    await discardPhotoCopies([], JOB)

    expect(scratch.discard).not.toHaveBeenCalled()
  })
})
