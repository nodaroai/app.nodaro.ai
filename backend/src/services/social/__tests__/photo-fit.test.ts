/**
 * A photo over a network's byte limit is re-encoded as a JPEG that fits before
 * it is posted (Facebook refused a 2K GPT Image 2 PNG: "Photos should be less
 * than 10 MB"). Pinned here: what is sent as it is (without a copy), what is
 * re-encoded at its own size, what is scaled down, what fails open, and what a
 * failure to store the copy means for the post.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

const OWN_HOST = "https://cdn.test/"
const OWN_URL = `${OWN_HOST}images/a.png`
const OUTSIDE_URL = "https://example.com/a.png"
const COPY_URL = `${OWN_HOST}tmp/provider-input/job/social-photo-1.jpg`
const JOB = "11111111-2222-4333-8444-555555555555"

const storage = vi.hoisted(() => ({ headR2Object: vi.fn(), readR2Object: vi.fn() }))
vi.mock("../../../lib/storage.js", () => ({
  r2KeyFromOurUrl: (url: string) => (url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length) : null),
  headR2Object: storage.headR2Object,
  readR2Object: storage.readR2Object,
}))

const outside = vi.hoisted(() => ({ safeFetch: vi.fn(), chunks: vi.fn() }))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: outside.safeFetch }))
vi.mock("../../../lib/safe-fetch-bytes.js", () => ({ boundedPublicChunks: outside.chunks }))

const scratch = vi.hoisted(() => ({ upload: vi.fn(), discard: vi.fn() }))
vi.mock("../../../lib/job-scratch.js", () => ({
  uploadJobScratchBuffer: scratch.upload,
  discardJobScratchFile: scratch.discard,
}))

import { discardPhotoCopies, fitPhotoUnderBytes, fitRequestPhotos } from "../photo-fit.js"
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

/** Our own photo, `bytes` long, as storage reports it. */
function ownPhoto(bytes: Buffer): void {
  storage.headR2Object.mockResolvedValue({ exists: true, sizeBytes: bytes.length })
  storage.readR2Object.mockResolvedValue({ body: bytes, contentType: "image/png", size: bytes.length })
}

function headAnswer(headers: Record<string, string>, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), body: null }
}

function streamOf(...pieces: Buffer[]) {
  return async function* () {
    for (const piece of pieces) yield piece
  }
}

/** The JPEG that was stored, and what it was stored as. */
function storedCopy(): { bytes: Buffer; name: unknown; ext: unknown; type: unknown; jobId: unknown } {
  const [bytes, name, ext, type, jobId] = scratch.upload.mock.calls[0] as [Buffer, unknown, unknown, unknown, unknown]
  return { bytes, name, ext, type, jobId }
}

beforeEach(() => {
  storage.headR2Object.mockReset()
  storage.readR2Object.mockReset()
  outside.safeFetch.mockReset()
  outside.chunks.mockReset()
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
  it("sends a photo within the limit as it is, without reading it", async () => {
    storage.headR2Object.mockResolvedValue({ exists: true, sizeBytes: 1_000 })

    const fitted = await fitPhotoUnderBytes(OWN_URL, 5_000, JOB)

    expect(fitted).toEqual({ url: OWN_URL, copied: false })
    expect(storage.headR2Object).toHaveBeenCalledWith("images/a.png")
    expect(storage.readR2Object).not.toHaveBeenCalled()
    expect(scratch.upload).not.toHaveBeenCalled()
  })

  it("re-encodes an oversized photo as a JPEG at its own size when that fits", async () => {
    const png = await noisePng(320, 240)
    const jpeg = await jpegAtFullSize(png)
    expect(png.length).toBeGreaterThan(jpeg.length)
    const limit = Math.floor((png.length + jpeg.length) / 2)
    ownPhoto(png)

    const fitted = await fitPhotoUnderBytes(OWN_URL, limit, JOB)

    expect(fitted).toEqual({ url: COPY_URL, copied: true })
    const copy = storedCopy()
    expect([copy.name, copy.ext, copy.type, copy.jobId]).toEqual(["social-photo", "jpg", "image/jpeg", JOB])
    const meta = await sharp(copy.bytes).metadata()
    expect(meta.format).toBe("jpeg")
    expect([meta.width, meta.height]).toEqual([320, 240])
    expect(copy.bytes.length).toBeLessThanOrEqual(limit)
  })

  it("scales a photo down only when its JPEG at full size is still too large, keeping its shape", async () => {
    const png = await noisePng(400, 300)
    const jpeg = await jpegAtFullSize(png)
    const limit = Math.floor(jpeg.length / 3)
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
    const jpeg = await jpegAtFullSize(png)
    ownPhoto(png)

    await fitPhotoUnderBytes(OWN_URL, Math.floor((png.length + jpeg.length) / 2), JOB)

    const meta = await sharp(storedCopy().bytes).metadata()
    expect(meta.channels).toBe(3)
    expect(meta.hasAlpha).toBe(false)
  })

  it("does not download an outside photo whose server states a size within the limit", async () => {
    outside.safeFetch.mockResolvedValue(headAnswer({ "content-length": "1000" }))

    const fitted = await fitPhotoUnderBytes(OUTSIDE_URL, 5_000, JOB)

    expect(fitted).toEqual({ url: OUTSIDE_URL, copied: false })
    expect(outside.safeFetch).toHaveBeenCalledWith(OUTSIDE_URL, expect.objectContaining({ method: "HEAD" }))
    expect(outside.chunks).not.toHaveBeenCalled()
    expect(storage.headR2Object).not.toHaveBeenCalled()
  })

  it("downloads an outside photo of unstated size and sends it as it is when it fits", async () => {
    outside.safeFetch.mockResolvedValue(headAnswer({}))
    outside.chunks.mockImplementation(streamOf(Buffer.alloc(3_000)))

    const fitted = await fitPhotoUnderBytes(OUTSIDE_URL, 5_000, JOB)

    expect(fitted).toEqual({ url: OUTSIDE_URL, copied: false })
    expect(outside.chunks).toHaveBeenCalledWith(OUTSIDE_URL, expect.objectContaining({ label: "Image" }))
    expect(scratch.upload).not.toHaveBeenCalled()
  })

  it("re-encodes an oversized outside photo through the SSRF-safe download", async () => {
    const png = await noisePng(320, 240)
    const jpeg = await jpegAtFullSize(png)
    outside.safeFetch.mockResolvedValue(headAnswer({ "content-length": String(png.length) }))
    const half = Math.floor(png.length / 2)
    outside.chunks.mockImplementation(streamOf(png.subarray(0, half), png.subarray(half)))

    const fitted = await fitPhotoUnderBytes(OUTSIDE_URL, Math.floor((png.length + jpeg.length) / 2), JOB)

    expect(fitted).toEqual({ url: COPY_URL, copied: true })
  })

  it("reads our own photo from the public address when storage cannot serve it", async () => {
    const png = await noisePng(320, 240)
    const jpeg = await jpegAtFullSize(png)
    storage.headR2Object.mockResolvedValue({ exists: true, sizeBytes: png.length })
    storage.readR2Object.mockResolvedValue(null)
    outside.chunks.mockImplementation(streamOf(png))

    const fitted = await fitPhotoUnderBytes(OWN_URL, Math.floor((png.length + jpeg.length) / 2), JOB)

    expect(fitted.copied).toBe(true)
    expect(outside.chunks).toHaveBeenCalledWith(OWN_URL, expect.anything())
  })

  it("sends a photo it cannot read as it is: the network then answers for it", async () => {
    storage.headR2Object.mockResolvedValue({ exists: true, sizeBytes: 50_000_000 })
    storage.readR2Object.mockResolvedValue(null)
    outside.chunks.mockImplementation(async function* () {
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

  it("reports a copy it could not store as NOT published, safe to retry", async () => {
    const png = await noisePng(320, 240)
    const jpeg = await jpegAtFullSize(png)
    ownPhoto(png)
    scratch.upload.mockRejectedValue(new Error("storage unavailable"))

    const err = await fitPhotoUnderBytes(OWN_URL, Math.floor((png.length + jpeg.length) / 2), JOB)
      .then(() => null)
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(NotPublishedError)
    expect((err as Error).message).toMatch(/NOT published/)
    expect((err as Error).message).not.toMatch(/MAY have been published/i)
  })
})

describe("fitRequestPhotos", () => {
  it("leaves the request as it is when the network declares no photo limit", async () => {
    const request = { action: "post-image", mediaUrl: OWN_URL }

    const fitted = await fitRequestPhotos(request, undefined, JOB)

    expect(fitted.request).toBe(request)
    expect(fitted.copies).toEqual([])
    expect(storage.headR2Object).not.toHaveBeenCalled()
  })

  it("puts the fitted photo in a new request and leaves the given one untouched", async () => {
    const png = await noisePng(320, 240)
    const jpeg = await jpegAtFullSize(png)
    ownPhoto(png)
    const request = { action: "post-image", caption: "hi", mediaUrl: OWN_URL }

    const fitted = await fitRequestPhotos(request, Math.floor((png.length + jpeg.length) / 2), JOB)

    expect(fitted.request).toEqual({ action: "post-image", caption: "hi", mediaUrl: COPY_URL })
    expect(fitted.copies).toEqual([COPY_URL])
    expect(request.mediaUrl).toBe(OWN_URL)
  })

  it("never touches a video", async () => {
    const request = { action: "post-video", mediaUrl: OWN_URL, mediaItems: [{ type: "video" as const, url: OWN_URL }] }

    const fitted = await fitRequestPhotos(request, 5_000, JOB)

    expect(fitted.request).toEqual(request)
    expect(fitted.copies).toEqual([])
    expect(storage.headR2Object).not.toHaveBeenCalled()
  })

  it("fits a photo named twice (a scheduled post's mediaUrl and its one item) once", async () => {
    const png = await noisePng(320, 240)
    const jpeg = await jpegAtFullSize(png)
    ownPhoto(png)
    const request = { action: "post-image", mediaUrl: OWN_URL, mediaItems: [{ type: "photo" as const, url: OWN_URL }] }

    const fitted = await fitRequestPhotos(request, Math.floor((png.length + jpeg.length) / 2), JOB)

    expect(scratch.upload).toHaveBeenCalledTimes(1)
    expect(fitted.request).toEqual({ action: "post-image", mediaUrl: COPY_URL, mediaItems: [{ type: "photo", url: COPY_URL }] })
    expect(fitted.copies).toEqual([COPY_URL])
  })

  it("fits every photo of a carousel", async () => {
    const png = await noisePng(320, 240)
    const jpeg = await jpegAtFullSize(png)
    ownPhoto(png)
    scratch.upload.mockResolvedValueOnce(`${COPY_URL}?1`).mockResolvedValueOnce(`${COPY_URL}?2`)
    const request = {
      action: "post-carousel",
      mediaItems: [
        { type: "photo" as const, url: `${OWN_HOST}images/1.png` },
        { type: "photo" as const, url: `${OWN_HOST}images/2.png` },
      ],
    }

    const fitted = await fitRequestPhotos(request, Math.floor((png.length + jpeg.length) / 2), JOB)

    expect(fitted.request.mediaItems).toEqual([
      { type: "photo", url: `${COPY_URL}?1` },
      { type: "photo", url: `${COPY_URL}?2` },
    ])
    expect(fitted.copies).toEqual([`${COPY_URL}?1`, `${COPY_URL}?2`])
  })

  it("discards the copies already made when a later photo fails, and rethrows", async () => {
    const png = await noisePng(320, 240)
    const jpeg = await jpegAtFullSize(png)
    ownPhoto(png)
    scratch.upload.mockResolvedValueOnce(COPY_URL).mockRejectedValueOnce(new Error("storage unavailable"))
    const request = {
      action: "post-carousel",
      mediaItems: [
        { type: "photo" as const, url: `${OWN_HOST}images/1.png` },
        { type: "photo" as const, url: `${OWN_HOST}images/2.png` },
      ],
    }

    await expect(fitRequestPhotos(request, Math.floor((png.length + jpeg.length) / 2), JOB)).rejects.toBeInstanceOf(
      NotPublishedError,
    )
    expect(scratch.discard).toHaveBeenCalledWith(COPY_URL, JOB)
  })
})

describe("discardPhotoCopies", () => {
  it("deletes each copy from the job's scratch folder", async () => {
    await discardPhotoCopies([COPY_URL, `${COPY_URL}?2`], JOB)

    expect(scratch.discard).toHaveBeenCalledWith(COPY_URL, JOB)
    expect(scratch.discard).toHaveBeenCalledWith(`${COPY_URL}?2`, JOB)
  })

  it("does nothing when no copy was made or no job names the folder", async () => {
    await discardPhotoCopies([], JOB)
    await discardPhotoCopies([COPY_URL], undefined)

    expect(scratch.discard).not.toHaveBeenCalled()
  })
})
